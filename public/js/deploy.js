// 部署状态页 — 30 秒自动刷新

const STATUS_LABELS = {
  'up-to-date':       { text: '已是最新',   cls: 'status-healthy',  icon: 'check-circle' },
  'update-available': { text: '有新版本',   cls: 'status-degraded', icon: 'arrow-up-circle' },
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

function tsToTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function stageIcon(stage) {
  const map = { check: 'search', download: 'download', deploy: 'package-plus', restart: 'refresh-cw' };
  return map[stage] || 'circle';
}

function stageLabel(stage) {
  const map = { check: '检查更新', download: '下载产物', deploy: '部署', restart: '重启' };
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
  const conclusion = ci.conclusion;
  const cls = conclusion === 'success' ? 'ci-success' :
              conclusion === 'failure' ? 'ci-failure' :
              conclusion === 'cancelled' ? 'ci-cancelled' : 'ci-pending';
  return `<a class="deploy-link ${cls}" href="${escHtml(ci.htmlUrl || '#')}" target="_blank" rel="noopener">
    <i data-lucide="${cls === 'ci-success' ? 'check-circle' : cls === 'ci-failure' ? 'x-circle' : 'loader'}" class="icon-sm"></i>
    <span>${escHtml(ci.name)}</span>
    <span class="ci-status">${info.text}</span>
    <span class="ci-time">${ago}</span>
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

      <!-- 部署时间线 -->
      <div class="deploy-section">
        <div class="deploy-section-title">部署时间线</div>
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
    grid.innerHTML = (data.services || []).map(renderCard).join('');

    // 渲染 Lucide 图标
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (err) {
    console.error('[deploy]', err);
    grid.innerHTML = '<div class="empty-state">加载失败，请刷新重试</div>';
  }
}

// 初始化
refreshPage();

// 30 秒自动刷新
setInterval(refreshPage, 30000);
