/**
 * WeAuto ↔ WeMonitor 契约测试（消费者侧）
 *
 * lib/api/auto.js 是两个仓库之间的适配层，字段名或状态取值一旦对不上，故障是
 * **静默**的：面板显示空白、时间列全是「—」、统计数字不动，但没有任何报错。
 *
 * fixtures/ 下是 2026-10-13 从 N150 生产环境抓取的真实样本：
 *   · weauto-list.json  ← `node ~/weauto/bin/weauto.mjs list --json`
 *   · weauto-runs.jsonl ← ~/weauto/data/runs.jsonl（前 5 条）
 *
 * 生产侧的对应断言在 WeAuto/tests/contract.test.mjs。两侧同时失败才算契约破裂；
 * 只有一侧失败，说明是那一侧的实现漂移了。
 *
 * 站点/任务字段变更后请重新抓取 fixture，否则测的是历史而不是现在。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { computeStats, decorateTasks, isSuccess, readRuns } = require('../lib/api/auto.js');

const HERE = __dirname;
const LIST_FIXTURE = path.join(HERE, 'fixtures', 'weauto-list.json');
const RUNS_FIXTURE = path.join(HERE, 'fixtures', 'weauto-runs.jsonl');

/** WeAuto `weauto list --json` 每个任务必须提供的字段 */
const TASK_FIELDS = ['name', 'displayName', 'requires', 'file', 'window', 'target'];
/** runs.jsonl 每条记录必须提供的字段（面板表格与统计都依赖） */
const RUN_FIELDS = ['ts', 'time', 'date', 'task', 'status', 'message', 'dur'];
/** WeAuto src/runner.mjs STATUS 的取值集合 */
const CONTRACT_STATUSES = [
  'success',
  'already-signed',
  'skipped',
  'failed',
  'blocked',
  'network-error',
  'config-error',
];

describe('契约：`list --json` 的任务结构', () => {
  it('每个任务都带齐 WeMonitor 渲染状态卡所需的字段', () => {
    const { tasks } = JSON.parse(fs.readFileSync(LIST_FIXTURE, 'utf8'));
    assert.ok(Array.isArray(tasks) && tasks.length > 0);
    for (const t of tasks) {
      for (const key of TASK_FIELDS) {
        assert.ok(key in t, `任务 ${t.name} 缺少字段 ${key}`);
      }
    }
  });

  it('窗口与目标时刻的结构与面板取值方式一致', () => {
    const { tasks } = JSON.parse(fs.readFileSync(LIST_FIXTURE, 'utf8'));
    const t = tasks[0];
    assert.deepEqual(Object.keys(t.window).sort(), ['end', 'start']);
    assert.deepEqual(Object.keys(t.target).sort(), ['date', 'remaining', 'targetLabel']);
  });
});

describe('契约：runs.jsonl 的记录结构', () => {
  it('能解析真实记录且字段齐全', () => {
    const runs = readRuns(50, RUNS_FIXTURE);
    assert.ok(runs.length > 0, 'fixture 不应为空');
    for (const r of runs) {
      for (const key of RUN_FIELDS) {
        assert.ok(key in r, `运行记录缺少字段 ${key}`);
      }
    }
  });

  it('读出的顺序是最新在前', () => {
    const runs = readRuns(50, RUNS_FIXTURE);
    for (let i = 1; i < runs.length; i++) {
      assert.ok(runs[i - 1].ts >= runs[i].ts, '记录应按 ts 倒序');
    }
  });

  it('真实记录里的状态都在契约清单内（出现新状态必须同步前端映射表）', () => {
    for (const r of readRuns(50, RUNS_FIXTURE)) {
      assert.ok(
        CONTRACT_STATUSES.includes(r.status),
        `状态 ${r.status} 未纳入契约，需要同步 public/js/auto.js 的 AUTO_STATUS`,
      );
    }
  });

  it('文件缺失或损坏时降级为空数组，不抛错', () => {
    assert.deepEqual(readRuns(10, path.join(HERE, 'fixtures', 'does-not-exist.jsonl')), []);
  });
});

describe('契约：任务清单 ↔ 执行记录的适配', () => {
  const TODAY = '2026-10-13';

  it('用真实 fixture 装饰后，每个任务都带上面板需要的三个派生字段', () => {
    const { tasks } = JSON.parse(fs.readFileSync(LIST_FIXTURE, 'utf8'));
    const decorated = decorateTasks(tasks, readRuns(50, RUNS_FIXTURE), TODAY);

    assert.equal(decorated.length, tasks.length);
    for (const t of decorated) {
      for (const key of TASK_FIELDS) assert.ok(key in t, `装饰后丢失了原始字段 ${key}`);
      assert.ok('todayStatus' in t);
      assert.ok('todayTime' in t);
      assert.ok('lastSuccess' in t);
    }
  });

  it('按 task + date 命中今日记录', () => {
    const runs = [{ task: 't', date: TODAY, status: 'already-signed', time: '2026-10-13 18:18:13' }];
    const [t] = decorateTasks([{ name: 't' }], runs, TODAY);
    assert.equal(t.todayStatus, 'already-signed');
    assert.equal(t.todayTime, '2026-10-13 18:18:13');
  });

  it('今日无记录时三个派生字段都是 null（前端据此显示「今天还没跑」）', () => {
    const [t] = decorateTasks([{ name: 't' }], [], TODAY);
    assert.equal(t.todayStatus, null);
    assert.equal(t.todayTime, null);
    assert.equal(t.lastSuccess, null);
  });

  it('昨天的成功不算今日结果，但仍作为 lastSuccess', () => {
    const runs = [{ task: 't', date: '2026-10-12', status: 'success', ts: 1 }];
    const [t] = decorateTasks([{ name: 't' }], runs, TODAY);
    assert.equal(t.todayStatus, null);
    assert.equal(t.lastSuccess.status, 'success');
  });

  it('lastSuccess 跳过失败记录，取最近一次成功', () => {
    const runs = [
      { task: 't', date: TODAY, status: 'failed', ts: 3 },
      { task: 't', date: '2026-10-12', status: 'success', ts: 2 },
    ];
    const [t] = decorateTasks([{ name: 't' }], runs, TODAY);
    assert.equal(t.lastSuccess.ts, 2);
  });

  it('多任务互不干扰', () => {
    const runs = [{ task: 'a', date: TODAY, status: 'success' }];
    const out = decorateTasks([{ name: 'a' }, { name: 'b' }], runs, TODAY);
    assert.equal(out[0].todayStatus, 'success');
    assert.equal(out[1].todayStatus, null);
  });
});

describe('契约：状态分类与统计口径', () => {
  it('成功状态恰好是 success 与 already-signed', () => {
    for (const s of CONTRACT_STATUSES) {
      assert.equal(isSuccess(s), ['success', 'already-signed'].includes(s), `${s} 分类不一致`);
    }
  });

  it('skipped 不计入累计次数（否则会被 cron 的高频触发灌水）', () => {
    const runs = [{ status: 'skipped' }, { status: 'skipped' }, { status: 'success' }, { status: 'failed' }];
    assert.deepEqual(computeStats(runs), { total: 2, success: 1, failed: 1 });
  });

  it('already-signed 计入成功', () => {
    assert.deepEqual(computeStats([{ status: 'already-signed' }]), { total: 1, success: 1, failed: 0 });
  });

  it('空输入返回全 0', () => {
    assert.deepEqual(computeStats([]), { total: 0, success: 0, failed: 0 });
  });
});
