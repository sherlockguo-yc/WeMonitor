// 部署状态页 — 30 秒自动刷新

const STATUS_LABELS = {
  'up-to-date':       { text: '已是最新',   cls: 'status-healthy',  icon: 'check-circle' },
  'update-available': { text: '有新版本',   cls: 'status-degraded', icon: 'arrow-up-circle' },
  'queued':           { text: '排队中...',  cls: 'status-degraded', icon: 'clock-3' },
  'deploying':        { text: '部署中...',  cls: 'status-degraded', icon: 'loader' },
  'error':            { text: '部署出错',   cls: 'status-unhealthy',icon: 'alert-circle' },
  'stopped':          { text: '服务未运行', cls: 'status-unhealthy',icon: 'x-circle' },
  'unknown':          { text: '状态未知',   cls: '',                icon: 'help-circle' },
};

const CI_LABELS = {
  'completed': { el: 'success', text: '构建成功' },
  'failure':   { el: 'failure', text: '构建失败' },
  'cancelled': { el: 'cancelled', text: '已取消' },
  'in_progress': { text: '构建中...' },
  'queued':    { text: '排队中...' },
};

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

function formatCIAbsoluteTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function tsToTime(ts) {
  const d = new Date(ts * 1000);
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const DD = String(d.getDate()).padStart(2, '0');
  const HH = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${MM}-${DD} ${HH}:${mm}:${ss}`;
}

function stageIcon(stage) {
  const map = {
    queue: 'clock-3', worker: 'bot', check: 'search', download: 'download',
    verify: 'shield-check', deploy: 'package-plus', restart: 'refresh-cw', healthcheck: 'heart-pulse',
  };
  return map[stage] || 'circle';
}

function stageLabel(stage) {
  const map = {
    queue: '等待队列', worker: '部署 worker', check: '检查更新', download: '下载产物',
    verify: '校验产物', deploy: '同步文件', restart: '重启服务', healthcheck: '健康检查',
  };
  return map[stage] || stage;
}

function triggerLabel(trigger) {
  if (!trigger) return '';
  return trigger === 'webhook' ? 'Webhook' : 'Cron';
}
function triggerClass(trigger) {
  return trigger === 'webhook' ? 'tl-trigger-webhook' : 'tl-trigger-cron';
}

function renderTimeline(events) {
  if (!events || events.length === 0) {
    return '<div class="tl-empty">暂无部署记录</div>';
  }
  return events.slice().reverse().map(e => {
    const icon = stageIcon(e.stage);
    const label = stageLabel(e.stage);
    const time = tsToTime(e.ts);
    const cls = e.status === 'error' ? 'tl-item-error' : e.status === 'started' ? 'tl-item-active' : '';
    const tLabel = triggerLabel(e.trigger);
    const tCls = triggerClass(e.trigger);
    return `<div class="tl-item ${cls}">
      <span class="tl-icon"><i data-lucide="${icon}" class="icon-sm"></i></span>
      <span class="tl-label">${label}</span>
      ${tLabel ? `<span class="tl-trigger ${tCls}" title="触发方式">${tLabel}</span>` : ''}
      <span class="tl-msg">${escHtml(e.message || '')}</span>
      <span class="tl-time">${time}</span>
    </div>`;
  }).join('');
}

function renderCISection(ci) {
  if (!ci) return '<div class="deploy-sub-text">CI 状态不可用</div>';
  const info = CI_LABELS[ci.conclusion] || CI_LABELS[ci.status] || { text: ci.status || '未知' };
  const ago = timeAgo(ci.updatedAt);
  const absTime = formatCIAbsoluteTime(ci.updatedAt);
  const conclusion = ci.conclusion;
  const cls = conclusion === 'success' ? 'ci-success' :
              conclusion === 'failure' ? 'ci-failure' :
              conclusion === 'cancelled' ? 'ci-cancelled' : 'ci-pending';
  return `<a class="deploy-link ${cls}" href="${escHtml(ci.htmlUrl || '#')}" target="_blank" rel="noopener">
    <i data-lucide="${cls === 'ci-success' ? 'check-circle' : cls === 'ci-failure' ? 'x-circle' : 'loader'}" class="icon-sm"></i>
    <span>${escHtml(ci.name)}</span>
    <span class="ci-status">${info.text}</span>
    <span class="ci-time">${ago} · ${absTime}</span>
  </a>`;
}

function renderVersion(local, remote) {
  const lv = local.version || '—';
  const rv = (remote && remote.release && remote.release.version) || null;

  if (!rv) {
    return `<div class="deploy-version">
      <span class="ver-local">${escHtml(lv)}</span>
      <span class="ver-label">本地版本</span>
    </div>`;
  }

  const same = lv === rv;
  const arrow = same
    ? '<i data-lucide="equal" class="icon-sm ver-icon-same"></i>'
    : '<i data-lucide="arrow-right" class="icon-sm ver-icon-diff"></i>';

  return `<div class="deploy-version">
    <div class="ver-row">
      <span class="ver-local" title="N150 当前运行版本">${escHtml(lv.substring(0, 7))}</span>
      ${arrow}
      <span class="ver-remote" title="GitHub 最新发布版本">${escHtml(rv.substring(0, 7))}</span>
    </div>
    <span class="ver-label">当前部署 / 远端可用</span>
  </div>`;
}

const PHASE_META = {
  queued: { text: '等待队列', icon: 'clock-3' },
  downloading: { text: '下载中', icon: 'download' },
  verifying: { text: '校验中', icon: 'shield-check' },
  syncing: { text: '同步中', icon: 'package-check' },
  restarting: { text: '重启中', icon: 'refresh-cw' },
  complete: { text: '已完成', icon: 'circle-check' },
  interrupted: { text: '已中断', icon: 'circle-pause' },
};

function formatDuration(startedAt, finishedAt) {
  const start = Number(startedAt);
  const end = Number(finishedAt) || Math.floor(Date.now() / 1000);
  if (!start || end < start) return '—';
  const seconds = end - start;
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
}

function taskKind(deploy) {
  if (deploy && deploy.active) return { task: deploy.active, kind: 'active' };
  if (deploy && deploy.pending) return { task: deploy.pending, kind: 'queued' };
  if (deploy && deploy.last) return { task: deploy.last, kind: deploy.last.status || 'complete' };
  return null;
}

function renderDeploymentState(deploy) {
  const current = taskKind(deploy);
  if (!current) return '<div class="deploy-state-empty">暂无队列任务</div>';

  const { task, kind } = current;
  const phase = kind === 'queued' ? 'queued' : task.phase || kind;
  const meta = PHASE_META[phase] || { text: kind === 'failed' ? '最近失败' : '状态未知', icon: 'circle-help' };
  const isError = kind === 'failed' || kind === 'interrupted';
  const statusClass = isError ? 'deploy-state-danger' :
    kind === 'active' || kind === 'queued' ? 'deploy-state-warning' : 'deploy-state-success';
  const trigger = triggerLabel(task.trigger) || '未知来源';
  const duration = task.startedAt ? formatDuration(task.startedAt, task.finishedAt) : '尚未开始';
  const attempt = Number(task.attempt) || 0;
  const message = task.message || (isError ? '未记录详细错误' : '');
  const title = `${meta.text}\n版本：${task.version || '—'}\n触发：${trigger}\n${message}`;

  return `<div class="deploy-state-bar ${statusClass}" title="${escHtml(title)}">
    <span class="deploy-state-icon"><i data-lucide="${meta.icon}" class="icon-sm"></i></span>
    <span class="deploy-state-phase">${escHtml(meta.text)}</span>
    <span class="deploy-state-version">${escHtml((task.version || '—').substring(0, 7))}</span>
    <span class="deploy-state-meta">${escHtml(trigger)} · ${escHtml(duration)}${attempt ? ` · 第 ${attempt} 次` : ''}</span>
    ${message ? `<span class="deploy-state-message">${escHtml(message)}</span>` : ''}
  </div>`;
}

function renderWorkerSummary(worker) {
  const badge = document.getElementById('worker-state-badge');
  const body = document.getElementById('worker-summary-body');
  if (!badge || !body) return;

  if (!worker) {
    badge.className = 'worker-state-badge';
    badge.textContent = '状态不可用';
    body.innerHTML = '<span class="worker-summary-empty">未读取到 worker 状态文件</span>';
    return;
  }

  const pending = Array.isArray(worker.pending) ? worker.pending : [];
  const isWorking = worker.status === 'working';
  const phase = worker.phase && PHASE_META[worker.phase] ? PHASE_META[worker.phase].text : '空闲';
  badge.className = `worker-state-badge ${isWorking ? 'worker-state-warning' : 'worker-state-idle'}`;
  badge.textContent = isWorking ? `工作中 · ${phase}` : '空闲';

  const active = isWorking
    ? `<div class="worker-active-task"><i data-lucide="${PHASE_META[worker.phase]?.icon || 'bot'}" class="icon-sm"></i><span>${escHtml(worker.project || '未知项目')}</span><code>${escHtml((worker.version || '—').substring(0, 7))}</code><span>${escHtml(phase)}</span></div>`
    : '<div class="worker-active-task worker-idle"><i data-lucide="circle-check" class="icon-sm"></i><span>无活动任务</span></div>';
  const queue = pending.length
    ? pending.map(task => `<span class="worker-queue-item"><strong>${escHtml(task.project)}</strong><code>${escHtml((task.version || '—').substring(0, 7))}</code></span>`).join('')
    : '<span class="worker-queue-empty">没有待处理任务</span>';
  const details = isWorking
    ? `<span>PID ${escHtml(String(worker.pid || '—'))}</span><span>已运行 ${escHtml(formatDuration(worker.startedAt))}</span>`
    : `<span>上次心跳 ${worker.updatedAt ? escHtml(tsToTime(worker.updatedAt)) : '—'}</span>`;

  body.innerHTML = `${active}
    <div class="worker-facts">${details}<span>队列 ${pending.length} 项</span></div>
    <div class="worker-queue"><span class="worker-queue-label">待部署</span>${queue}</div>`;
}

function renderCard(svc) {
  const status = STATUS_LABELS[svc.summary] || STATUS_LABELS['unknown'];

  return `<div class="card deploy-card">
    <div class="card-header deploy-card-header">
      <div class="deploy-service-name">
        <i data-lucide="${svc.id === 'wemonitor' ? 'activity' : 'music'}" class="icon-md"></i>
        <h3>${escHtml(svc.name)}</h3>
      </div>
      <span class="status-badge ${status.cls}">
        <i data-lucide="${status.icon}" class="icon-sm"></i>
        ${status.text}
      </span>
    </div>
    <div class="card-body deploy-card-body">
      <!-- 版本对比 -->
      <div class="deploy-section">
        <div class="deploy-section-title">版本</div>
        ${renderVersion(svc.local, svc.remote)}
      </div>

      <!-- CI 状态 -->
      <div class="deploy-section">
        <div class="deploy-section-title">CI 构建</div>
        ${renderCISection(svc.remote && svc.remote.ci)}
      </div>

      <!-- CD 部署 -->
      <div class="deploy-section">
        <div class="deploy-section-title">CD 部署</div>
        ${renderDeploymentState(svc.local.deploy)}
        <div class="tl-list">
          ${renderTimeline(svc.local.events)}
        </div>
      </div>
    </div>
  </div>`;
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function refreshPage() {
  const grid = document.getElementById('deploy-grid');
  try {
    const res = await fetch('/api/v1/deploy/status');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    renderWorkerSummary(data.worker);
    grid.innerHTML = (data.services || []).map(renderCard).join('');

    // 渲染 Lucide 图标
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (err) {
    console.error('[deploy]', err);
    renderWorkerSummary(null);
    grid.innerHTML = '<div class="empty-state">加载失败，请刷新重试</div>';
  }

  // 同步刷新 CI/CD 拓扑
  if (typeof loadCicdTopology === 'function') loadCicdTopology();
}

// 初始化
refreshPage();

// 30 秒自动刷新
setInterval(refreshPage, 30000);
