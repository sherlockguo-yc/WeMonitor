// WeAuto 自动化任务 — 读取执行记录、查询任务清单、手动触发
//
// WeAuto 是一个无端口的被动 CLI（~/weauto），本模块只做三件事：
//   1. 读 ~/weauto/data/runs.jsonl 拿到业务级执行记录
//   2. 调 `weauto list --json` 拿到任务清单与今日目标时刻（调度算法不在此重复实现）
//   3. 调 `weauto run <task> --force` 手动触发一次
//
// 本模块是两个仓库之间的适配层，契约无法在编译期校验：字段名或状态取值一旦对不上，
// 页面上只会表现为「空白」「历史不显示」这类沉默的故障。契约由两侧测试共同守住 ——
// 消费者侧 tests/auto-contract.test.mjs，生产侧 WeAuto/tests/contract.test.mjs。

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const local = require('../deploy/local');

const WEAUTO_DIR = local.WEAUTO_DIR;
const RUNS_FILE = path.join(WEAUTO_DIR, 'data', 'runs.jsonl');
const CLI = path.join(WEAUTO_DIR, 'bin', 'weauto.mjs');

// 任务名白名单：仅允许小写字母、数字与连字符，杜绝把任意字符串交给子进程
const TASK_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** 视为「今天这件事已办成」的状态；与 WeAuto src/history.mjs 的 SUCCESS_STATUSES 对齐 */
const SUCCESS_STATUSES = ['success', 'already-signed'];

/** 表示「本次没有动作」：不计入统计，否则累计次数会被 cron 的高频触发灌水 */
const NON_EXECUTED_STATUS = 'skipped';

function isSuccess(status) {
  return SUCCESS_STATUSES.includes(status);
}

// 执行子进程（沿用 lib/tunnel.js 的 run() 模式）
function run(args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      args,
      { timeout: 90000, maxBuffer: 1024 * 1024, ...opts },
      (err, stdout, stderr) => {
        resolve({
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim(),
          error: err ? err.message : null,
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        });
      },
    );
  });
}

// 读取 runs.jsonl（倒序返回，最新在前；文件缺失或单行损坏均降级）
// file 参数用于测试注入 fixture，生产调用只传 limit
function readRuns(limit = 200, file = RUNS_FILE) {
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch (_) {
    return [];
  }
}

async function getTasks() {
  const { stdout, error } = await run([CLI, 'list', '--json']);
  if (error) return { tasks: [], error };
  try {
    const parsed = JSON.parse(stdout);
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [], error: null };
  } catch (_) {
    return { tasks: [], error: '任务清单解析失败' };
  }
}

/**
 * 把任务清单与执行记录合并成面板状态卡所需的数据
 *
 * 抽成纯函数是为了可测：这里是契约的核心。WeAuto 侧的 task 名、date 口径或
 * status 取值一变，本函数就会安静地返回 null 字段 —— 页面上只是「看起来空着」。
 *
 * @param {Array} tasks `weauto list --json` 的 tasks 数组
 * @param {Array} runs runs.jsonl 的记录（最新在前）
 * @param {string} today 北京时间日期 YYYY-MM-DD
 */
function decorateTasks(tasks, runs, today) {
  return tasks.map((t) => {
    const todayRun = runs.find((r) => r.task === t.name && r.date === today);
    const lastOk = runs.find((r) => r.task === t.name && isSuccess(r.status));
    return {
      ...t,
      todayStatus: todayRun ? todayRun.status : null,
      todayTime: todayRun ? todayRun.time : null,
      lastSuccess: lastOk || null,
    };
  });
}

/**
 * 面板顶部的统计口径
 * @param {Array} runs runs.jsonl 的记录
 */
function computeStats(runs) {
  const executed = runs.filter((r) => r.status !== NON_EXECUTED_STATUS);
  const success = executed.filter((r) => isSuccess(r.status)).length;
  return { total: executed.length, success, failed: executed.length - success };
}

// GET /api/v1/auto/status
async function getStatus(req, res) {
  try {
    const runs = readRuns(500);
    const { tasks, error } = await getTasks();

    // 与 WeAuto 内部一致的日期口径（北京时间）
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const executed = runs.filter((r) => r.status !== NON_EXECUTED_STATUS);

    res.json({
      available: !error,
      error: error || null,
      dir: WEAUTO_DIR,
      version: local.readVersion(WEAUTO_DIR),
      today,
      tasks: decorateTasks(tasks, runs, today),
      latest: executed[0] || null,
      lastSuccess: runs.find((r) => isSuccess(r.status)) || null,
      stats: computeStats(runs),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/v1/auto/runs?limit=50
function getRuns(req, res) {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  res.json({ runs: readRuns(limit) });
}

// POST /api/v1/auto/trigger  { task }
async function trigger(req, res) {
  const task = (req.body && req.body.task) || '';
  if (!TASK_NAME_RE.test(task)) {
    return res.status(400).json({ error: '无效的任务名' });
  }

  // 先确认任务已注册，避免把任意字符串交给 CLI
  const { tasks } = await getTasks();
  if (!tasks.some((t) => t.name === task)) {
    return res.status(404).json({ error: `未注册的任务：${task}` });
  }

  const { stdout, stderr, code } = await run([CLI, 'run', task, '--force']);
  res.json({
    ok: code === 0,
    code,
    output: stdout || stderr || '(无输出)',
  });
}

module.exports = {
  getStatus,
  getRuns,
  trigger,
  // 以下为纯函数，导出供 tests/auto-contract.test.mjs 直接断言契约
  isSuccess,
  readRuns,
  decorateTasks,
  computeStats,
};
