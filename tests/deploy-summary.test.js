const test = require('node:test');
const assert = require('node:assert');
const { isStalePending, sanitizeDeployState } = require('../lib/deploy/summary');

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
