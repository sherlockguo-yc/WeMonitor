// 部署队列状态清洗 — 识别并丢弃 state 文件里无法再被 worker 消费的 pending。
//
// 背景（2026-11 事故）：deploy-agent.sh 在「本地 .version 已等于目标版本」时
// 走短路分支直接写 succeeded 终态，该路径不经过 active 阶段，而 pending
// 只在 active 阶段被清除。于是 state 里会残留一条永远不消费的 queued 任务，
// 部署页与拓扑图会永久显示「排队中」。WeDou 2a1749e 就这样卡了 5 天。
//
// 判断依据（任一成立即视为脏数据）：
//   1. pending.version 等于本地 .version —— 任务实际上早已部署完成；
//   2. 队列目录里没有对应 job，且已过入队缓冲期 —— 没有 worker 会处理它。

// 入队瞬间 state 与 job 文件的写入有毫秒级交错，留出缓冲期避免误判。
const STALE_PENDING_GRACE_SECONDS = 120;

function shortSha(value) {
  return typeof value === 'string' ? value.slice(0, 7).toLowerCase() : '';
}

function isStalePending(deploy, localState, worker) {
  const pending = deploy && deploy.pending;
  if (!pending) return false;
  // 有活动任务时以 active 为准，pending 会由 worker 消费
  if (deploy.active) return false;

  // 条件 1：本地已是该版本，说明这条 pending 早已完成，只是没被清掉
  const localVersion = shortSha(localState && localState.version);
  if (localVersion && localVersion === shortSha(pending.version)) return true;

  // worker 状态不可用时无法交叉校验队列，只按版本一致性判断，避免误清
  if (!worker) return false;

  // 条件 2：队列里没有对应 job 且已过缓冲期，说明没有 worker 会处理它
  const queuedAt = Number(pending.queuedAt) || 0;
  const age = queuedAt ? Date.now() / 1000 - queuedAt : 0;
  if (age <= STALE_PENDING_GRACE_SECONDS) return false;

  const jobs = worker && Array.isArray(worker.pending) ? worker.pending : [];
  const hasJob = jobs.some(job => job
    && job.project === pending.project
    && shortSha(job.version) === shortSha(pending.version));
  return !hasJob;
}

// 返回清洗后的 deploy 状态（不修改入参），供 API 与 summary 计算共用。
function sanitizeDeployState(deploy, localState, worker) {
  if (!deploy) return deploy;
  return isStalePending(deploy, localState, worker)
    ? { ...deploy, pending: null }
    : deploy;
}

module.exports = {
  isStalePending,
  sanitizeDeployState,
  shortSha,
  STALE_PENDING_GRACE_SECONDS,
};
