const test = require('node:test');
const assert = require('node:assert');
const { isStalePending, sanitizeDeployState, computeServiceSummary } = require('../lib/deploy/summary');

const NOW = Math.floor(Date.now() / 1000);

function state(pending, active = null) {
  return { project: 'wedou', active, pending, last: null };
}

function pending(version, queuedAt = NOW) {
  return { project: 'wedou', version, trigger: 'webhook', status: 'queued', phase: 'queued', queuedAt };
}

test('无 pending 时不做处理', () => {
  const deploy = state(null);
  assert.strictEqual(isStalePending(deploy, { version: '2a1749e' }, null), false);
  assert.strictEqual(sanitizeDeployState(deploy, { version: '2a1749e' }, null), deploy);
});

test('无 deploy 状态时原样返回', () => {
  assert.strictEqual(sanitizeDeployState(null, { version: '2a1749e' }, null), null);
});

// WeDou 2a1749e 的真实场景：worker 命中「版本已部署」短路，
// pending 永远不会被 active 阶段清除。
test('pending 版本等于本地版本时判定为脏数据', () => {
  const deploy = state(pending('2a1749e', NOW - 5 * 86400));
  const cleaned = sanitizeDeployState(deploy, { version: '2a1749e' }, { pending: [] });
  assert.strictEqual(cleaned.pending, null);
  assert.notStrictEqual(cleaned, deploy, '不应修改入参');
});

test('完整 SHA 与短 SHA 视为同一版本', () => {
  const deploy = state(pending('2a1749e5c1b2a3d4f5e6a7b8c9d0e1f2a3b4c5d6'));
  assert.strictEqual(isStalePending(deploy, { version: '2a1749e' }, null), true);
});

test('有待部署的新版本且在队列中时保留排队状态', () => {
  const deploy = state(pending('new1234'));
  const worker = { pending: [{ project: 'wedou', version: 'new1234' }] };
  assert.strictEqual(isStalePending(deploy, { version: '2a1749e' }, worker), false);
});

test('队列里没有对应 job 且已过缓冲期时判定为脏数据', () => {
  const deploy = state(pending('abcd123', NOW - 3600));
  assert.strictEqual(isStalePending(deploy, { version: '2a1749e' }, { pending: [] }), true);
});

test('刚入队的 pending 即使暂时读不到 job 也保留（写入交错缓冲）', () => {
  const deploy = state(pending('abcd123', NOW - 5));
  assert.strictEqual(isStalePending(deploy, { version: '2a1749e' }, { pending: [] }), false);
});

test('有活动任务时不清理 pending', () => {
  const deploy = state(
    pending('2a1749e', NOW - 600),
    { version: '2a1749e', phase: 'syncing', status: 'downloading' },
  );
  assert.strictEqual(isStalePending(deploy, { version: '2a1749e' }, { pending: [] }), false);
});

test('worker 状态缺失时只按版本一致性判断，不因缺少 job 交叉校验而误清', () => {
  const stale = state(pending('2a1749e', NOW - 3600));
  assert.strictEqual(isStalePending(stale, { version: '2a1749e' }, null), true);

  const pendingNewVersion = state(pending('ffff999', NOW - 3600));
  assert.strictEqual(isStalePending(pendingNewVersion, { version: '2a1749e' }, null), false);
});

// ── computeServiceSummary ──

const healthcheckError = {
  stage: 'healthcheck', status: 'error', message: '端口 4318 无响应，触发重启', trigger: 'cron', ts: NOW,
};

function localState(overrides = {}) {
  return {
    version: '4b6f0ea',
    events: [{ stage: 'complete', status: 'succeeded', message: '部署完成 4b6f0ea', ts: NOW - 60 }],
    deploy: null,
    alive: true,
    ...overrides,
  };
}

const remoteAt = version => ({ release: { version }, ci: null });

// 2026-11-14 03:00 N150 重启的真实场景：cron 发现端口掉线 → 写 healthcheck error
// → 立刻 restart.sh 拉起成功（不再补事件）。服务已自愈，不能一直显示红色。
test('最后一条事件是已自愈的 healthcheck error 时不判异常', () => {
  const local = localState({ events: [healthcheckError] });
  assert.strictEqual(computeServiceSummary(local, remoteAt('4b6f0ea')), 'up-to-date');
});

test('已自愈的 healthcheck error 不掩盖版本落后的提示', () => {
  const local = localState({ events: [healthcheckError] });
  assert.strictEqual(computeServiceSummary(local, remoteAt('aaaaaaa')), 'update-available');
});

test('healthcheck error 且端口仍不通时判 stopped', () => {
  const local = localState({ events: [healthcheckError], alive: false });
  assert.strictEqual(computeServiceSummary(local, remoteAt('4b6f0ea')), 'stopped');
});

test('部署流程自身的失败事件仍判异常', () => {
  const failed = { stage: 'restart', status: 'error', message: 'restart.sh 执行失败', ts: NOW };
  assert.strictEqual(computeServiceSummary(localState({ events: [failed] }), remoteAt('4b6f0ea')), 'error');
});

test('部署失败后即使又发生 healthcheck error，仍判异常', () => {
  const failed = { stage: 'restart', status: 'error', message: 'restart.sh 执行失败', ts: NOW - 60 };
  const local = localState({ events: [failed, healthcheckError] });
  assert.strictEqual(computeServiceSummary(local, remoteAt('4b6f0ea')), 'error');
});

test('队列状态优先于事件与版本比对', () => {
  const active = { project: 'wefood', active: { version: '4b6f0ea', phase: 'syncing' }, pending: null };
  assert.strictEqual(computeServiceSummary(localState({ deploy: active }), remoteAt('4b6f0ea')), 'deploying');

  const queued = { project: 'wefood', active: null, pending: pending('4b6f0ea') };
  assert.strictEqual(computeServiceSummary(localState({ deploy: queued }), remoteAt('4b6f0ea')), 'queued');
});

test('队列最后状态失败时判异常', () => {
  const deploy = { project: 'wefood', active: null, pending: null, last: { status: 'failed' } };
  assert.strictEqual(computeServiceSummary(localState({ deploy }), remoteAt('4b6f0ea')), 'error');
});

test('无远端版本时判未知', () => {
  assert.strictEqual(computeServiceSummary(localState(), remoteAt(null)), 'unknown');
});
