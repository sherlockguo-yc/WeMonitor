const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const JOBS_FILE = path.join(DATA_DIR, 'cron-jobs.json');
const HISTORY_FILE = path.join(DATA_DIR, 'cron-history.jsonl');
const MARKER_BEGIN = '# === WeMonitor BEGIN ===';
const MARKER_END = '# === WeMonitor END ===';

// ── ID 生成 ──
function genId() { return crypto.randomBytes(5).toString('hex'); }

// ── JSON 持久化 ──
function loadJobs() {
  try { return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8')); }
  catch { return []; }
}
function saveJobs(jobs) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

// ── crontab 读写 ──
function execCrontab(args = [], input) {
  return new Promise((resolve, reject) => {
    const child = execFile('crontab', args, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 1 && (stderr.includes('no crontab') || stdout === '')) return resolve('');
        return reject(err);
      }
      resolve(stdout.trim());
    });
    if (input !== undefined) { child.stdin.write(input); child.stdin.end(); }
  });
}

async function readCrontab() {
  try { return await execCrontab(['-l']); }
  catch { return ''; }
}

async function writeCrontab(content) {
  // If content is empty/whitespace, crontab -r (remove) is cleaner
  const trimmed = content.trim();
  if (!trimmed) {
    return new Promise((resolve, reject) => {
      execFile('crontab', ['-r'], { timeout: 5000 }, (err) => {
        if (err && err.code === 1 && err.message.includes('no crontab')) return resolve();
        if (err) return reject(err);
        resolve();
      });
    });
  }
  return execCrontab(['-'], trimmed + '\n');
}

// ── 生成 crontab ──
function generateCrontab(jobs) {
  const lines = [MARKER_BEGIN];
  if (!jobs.length) {
    lines.push('# No jobs configured');
    lines.push(MARKER_END);
    return lines.join('\n') + '\n';
  }

  const runner = path.join(__dirname, '..', 'scripts', 'cron-runner.js');
  const nodeBin = process.execPath;

  for (const job of jobs) {
    lines.push(`# id: ${job.id} | name: ${escapeCronComment(job.name)}`);
    const runnerCmd = `${nodeBin} ${runner} ${job.id}`;
    const entry = `${job.schedule} ${runnerCmd} ${job.command}`;
    if (job.enabled) {
      lines.push(entry);
    } else {
      lines.push(`# DISABLED: ${entry}`);
    }
  }
  lines.push(MARKER_END);
  return lines.join('\n') + '\n';
}

function escapeCronComment(str) {
  return (str || '').replace(/\n/g, ' ').replace(/#/g, '\\#');
}

// ── 提取 WeMonitor 段之外的内容 ──
function extractNonWmLines(crontabText) {
  const beginIdx = crontabText.indexOf(MARKER_BEGIN);
  const endIdx = crontabText.indexOf(MARKER_END);
  if (beginIdx >= 0 && endIdx > beginIdx) {
    const before = crontabText.substring(0, beginIdx).trim();
    const after = crontabText.substring(endIdx + MARKER_END.length).trim();
    return [before, after].filter(Boolean).join('\n');
  }
  return crontabText.trim();
}

// ── 同步到系统 ──
async function syncToSystem(jobs) {
  const existing = await readCrontab();
  const nonWm = extractNonWmLines(existing);
  const wm = generateCrontab(jobs).trim();
  const final = [nonWm, wm].filter(Boolean).join('\n\n');
  await writeCrontab(final);
}

// ── 检查同步状态 ──
async function getSyncStatus(jobs) {
  try {
    const existing = await readCrontab();
    const generated = generateCrontab(jobs).trim();
    // Extract only the WeMonitor section from existing
    const beginIdx = existing.indexOf(MARKER_BEGIN);
    const endIdx = existing.indexOf(MARKER_END);
    let existingWm = '';
    if (beginIdx >= 0 && endIdx > beginIdx) {
      existingWm = existing.substring(beginIdx, endIdx + MARKER_END.length).trim();
    }

    // No WeMonitor section at all → system crontab was never managed by WeMonitor.
    // Nothing to compare against, so treat it as in sync (not a mismatch).
    const inSync = beginIdx >= 0 ? (existingWm === generated) : true;

    return {
      inSync,
      hasWmSection: beginIdx >= 0,
      generatedHash: crypto.createHash('md5').update(generated).digest('hex').slice(0, 8),
      existingHash: crypto.createHash('md5').update(existingWm).digest('hex').slice(0, 8),
    };
  } catch {
    return { inSync: false, hasWmSection: false, error: '无法读取 crontab' };
  }
}

// ── 解析 crontab 中的 cron 条目 ──
const CRON_LINE_RE = /^(\s*(?:#\s*DISABLED:\s*)?)\s*(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/;

function parseCrontab(crontabText) {
  const entries = [];
  const lines = crontabText.split('\n');
  let lastComment = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { lastComment = ''; continue; }

    // Env var lines (VAR=value)
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(trimmed)) continue;

    // WeMonitor marker lines
    if (trimmed === MARKER_BEGIN || trimmed === MARKER_END) continue;

    // Pure comment line (not a disabled cron entry)
    if (trimmed.startsWith('#') && !trimmed.startsWith('# DISABLED:')) {
      const commentText = trimmed.replace(/^#\s*/, '');
      if (commentText && !commentText.startsWith('id: ')) {
        lastComment = commentText;
      }
      continue;
    }

    // Try to match a cron entry
    const match = trimmed.match(CRON_LINE_RE);
    if (match) {
      const [, disabledPrefix, schedule, rest] = match;
      const isDisabled = disabledPrefix.includes('DISABLED');

      // Split rest into runner + actual command
      // Format: node /path/to/cron-runner.js jobId actual_command...
      const parts = rest.split(/\s+/);
      let jobId = null, command = rest, runnerPath = '';

      // Check if this is a WeMonitor-wrapped entry
      const runnerIdx = parts.findIndex(p => p.endsWith('cron-runner.js'));
      if (runnerIdx >= 0 && runnerIdx + 1 < parts.length) {
        runnerPath = parts.slice(0, runnerIdx + 1).join(' ');
        jobId = parts[runnerIdx + 1];
        command = parts.slice(runnerIdx + 2).join(' ');
      }

      entries.push({
        id: jobId || genId(),
        name: lastComment || (command ? command.slice(0, 60) : '未命名任务'),
        schedule: schedule.trim(),
        command: command || rest,
        enabled: !isDisabled,
        isWeMonitor: !!jobId,
      });
      lastComment = '';
    }
  }
  return entries;
}

// ── 初始化：首次运行时从系统 crontab 导入 ──
async function init() {
  if (fs.existsSync(JOBS_FILE)) return loadJobs();

  // First run: import existing crontab
  let existing = '';
  try { existing = await readCrontab(); }
  catch { /* no crontab, start fresh */ }

  let jobs = [];
  if (existing) {
    const nonWm = extractNonWmLines(existing);
    if (nonWm) {
      jobs = parseCrontab(nonWm);
    }
  }

  if (jobs.length) {
    saveJobs(jobs);
    await syncToSystem(jobs);
    console.log(`[cron] Imported ${jobs.length} existing cron job(s) from system crontab`);
  } else {
    saveJobs([]);
    console.log('[cron] No existing cron jobs found, starting fresh');
  }

  return jobs;
}

// ── CRUD ──

async function listJobs() {
  const jobs = loadJobs();
  // Attach last run info from history
  for (const job of jobs) {
    const history = getHistory(job.id, 1);
    job.lastRun = history.length ? history[0] : null;
  }
  return jobs;
}

function getJob(id) {
  return loadJobs().find(j => j.id === id) || null;
}

async function createJob({ name, schedule, command, enabled = true }) {
  const jobs = loadJobs();
  const job = {
    id: genId(),
    name: (name || '未命名任务').trim(),
    schedule: schedule.trim(),
    command: command.trim(),
    enabled: !!enabled,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  jobs.push(job);
  saveJobs(jobs);
  await syncToSystem(jobs);
  return job;
}

async function updateJob(id, { name, schedule, command, enabled }) {
  const jobs = loadJobs();
  const idx = jobs.findIndex(j => j.id === id);
  if (idx === -1) return null;

  const job = jobs[idx];
  if (name !== undefined) job.name = name.trim();
  if (schedule !== undefined) job.schedule = schedule.trim();
  if (command !== undefined) job.command = command.trim();
  if (enabled !== undefined) job.enabled = !!enabled;
  job.updatedAt = new Date().toISOString();

  saveJobs(jobs);
  await syncToSystem(jobs);
  return job;
}

async function deleteJob(id) {
  const jobs = loadJobs();
  const idx = jobs.findIndex(j => j.id === id);
  if (idx === -1) return false;

  jobs.splice(idx, 1);
  saveJobs(jobs);
  await syncToSystem(jobs);
  return true;
}

async function toggleJob(id) {
  const jobs = loadJobs();
  const job = jobs.find(j => j.id === id);
  if (!job) return null;

  job.enabled = !job.enabled;
  job.updatedAt = new Date().toISOString();
  saveJobs(jobs);
  await syncToSystem(jobs);
  return job;
}

// ── 运行历史 ──
function getHistory(jobId, limit = 50) {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    let entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (jobId) entries = entries.filter(e => e.jobId === jobId);
    return entries.slice(-limit).reverse();
  } catch {
    return [];
  }
}

// ── 清理旧历史（保留最近 1000 条） ──
function cleanupHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return;
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    if (lines.length <= 1000) return;
    fs.writeFileSync(HISTORY_FILE, lines.slice(-1000).join('\n') + '\n');
  } catch { /* ignore */ }
}

// ── cron 表达式校验 ──
const FIELD_NAMES = ['分', '时', '日', '月', '周'];
const FIELD_RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

function validateSchedule(schedule) {
  if (!schedule || typeof schedule !== 'string') return { valid: false, error: 'schedule 为空' };

  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    return { valid: false, error: `cron 表达式需要 5 个字段，当前有 ${fields.length} 个` };
  }

  for (let i = 0; i < 5; i++) {
    const field = fields[i];
    const [min, max] = FIELD_RANGES[i];

    // Allow: *, */N, N, N-M, N,M, etc.
    const atoms = field.split(',');
    for (const atom of atoms) {
      if (atom === '*') continue;
      if (/^\*\/\d+$/.test(atom)) {
        const step = parseInt(atom.split('/')[1], 10);
        if (step < 1) return { valid: false, error: `${FIELD_NAMES[i]}字段步长无效: ${atom}` };
        continue;
      }
      if (/^\d+-\d+$/.test(atom)) {
        const [lo, hi] = atom.split('-').map(Number);
        if (lo < min || hi > max || lo > hi) return { valid: false, error: `${FIELD_NAMES[i]}字段范围无效: ${atom}（允许 ${min}-${max}）` };
        continue;
      }
      if (/^\d+$/.test(atom)) {
        const n = parseInt(atom, 10);
        if (n < min || n > max) return { valid: false, error: `${FIELD_NAMES[i]}字段值无效: ${atom}（允许 ${min}-${max}）` };
        continue;
      }
      return { valid: false, error: `${FIELD_NAMES[i]}字段格式无法识别: ${atom}` };
    }
  }
  return { valid: true };
}

module.exports = {
  init, loadJobs, saveJobs,
  readCrontab, writeCrontab, generateCrontab,
  syncToSystem, getSyncStatus,
  parseCrontab,
  listJobs, getJob, createJob, updateJob, deleteJob, toggleJob,
  getHistory, cleanupHistory,
  validateSchedule,
};
