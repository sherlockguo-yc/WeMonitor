/* ===================================================
   WeMonitor — 服务管理（含服务状态 / 部署状态子 Tab）
   =================================================== */

// ── Tab 切换 ──

let currentTab = 'manage';
let deployInterval = null;
let healthTimelineChart = null;

function switchTab(tab) {
  // 更新按钮状态
  document.querySelectorAll('#settings-tabs .tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // 显示/隐藏面板
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.style.display = 'none';
  });
  const panel = document.getElementById('tab-' + tab);
  if (panel) panel.style.display = '';

  // 清理部署自动刷新
  if (deployInterval) { clearInterval(deployInterval); deployInterval = null; }

  // 清理健康检查图表
  if (healthTimelineChart) { healthTimelineChart.destroy(); healthTimelineChart = null; }

  currentTab = tab;
  // 更新 URL hash（不触发页面滚动）
  if (window.location.hash !== '#' + tab) {
    history.replaceState(null, '', '#' + tab);
  }

  // 按需加载数据
  if (tab === 'manage') loadSettings();
  else if (tab === 'status') loadServicesPage();
  else if (tab === 'deploy') { refreshDeployPage(); deployInterval = setInterval(refreshDeployPage, 30000); }
}

// Tab 按钮点击事件
document.getElementById('settings-tabs').addEventListener('click', function(e) {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  switchTab(btn.dataset.tab);
});

// ── 工具函数 ──

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escapeHtml(str) { return escHtml(str); }

// ===================================================
//  Tab 1: 服务管理
// ===================================================

async function loadSettings() {
  const services = await api('/services');
  const tbody = document.getElementById('settings-services-body');

  if (!services || services.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">暂无服务</td></tr>';
    return;
  }

  tbody.innerHTML = services.map(s => `
    <tr>
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td>${s.scrape_url ? '<span style="color: var(--accent);">Pull</span>' : '<span style="color: var(--text-dim);">Push</span>'}</td>
      <td style="font-family: var(--font-mono); font-size: calc(var(--font-size) * 0.82);">
        ${s.scrape_url ? escapeHtml(s.scrape_url) : (s.health_target ? escapeHtml(s.health_target) : '--')}
      </td>
      <td>${s.scrape_interval}s</td>
      <td>
        <label class="toggle-switch" onclick="event.stopPropagation()">
          <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="toggleService(${s.id}, this.checked)">
          <span class="toggle-track"></span>
        </label>
      </td>
      <td>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-secondary btn-sm" onclick="editService(${s.id})" title="编辑">编辑</button>
          <button class="btn btn-danger btn-sm" onclick="deleteServiceConfirm(${s.id}, '${escapeHtml(s.name)}')" title="删除">删除</button>
        </div>
      </td>
    </tr>
  `).join('');

  refreshIcons();
}

function showAddForm() {
  document.getElementById('modal-title').textContent = '新增服务';
  document.getElementById('edit-id').value = '';
  document.getElementById('svc-name').value = '';
  document.getElementById('svc-scrape-url').value = '';
  document.getElementById('svc-scrape-interval').value = '30';
  document.getElementById('svc-health-target').value = '';
  document.getElementById('service-modal').style.display = 'flex';
}

async function editService(id) {
  const services = await api('/services');
  const svc = services.find(s => s.id == id);
  if (!svc) return;

  document.getElementById('modal-title').textContent = '编辑服务';
  document.getElementById('edit-id').value = svc.id;
  document.getElementById('svc-name').value = svc.name;
  document.getElementById('svc-scrape-url').value = svc.scrape_url || '';
  document.getElementById('svc-scrape-interval').value = svc.scrape_interval || 30;
  document.getElementById('svc-health-target').value = svc.health_target || '';
  document.getElementById('service-modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('service-modal').style.display = 'none';
}

async function saveService() {
  const id = document.getElementById('edit-id').value;
  const name = document.getElementById('svc-name').value.trim();
  const scrape_url = document.getElementById('svc-scrape-url').value.trim() || null;
  const scrape_interval = parseInt(document.getElementById('svc-scrape-interval').value) || 30;
  const health_target = document.getElementById('svc-health-target').value.trim() || null;

  if (!name) {
    alert('请输入服务名');
    return;
  }

  const body = { name, scrape_url, scrape_interval, health_type: 'tcp', health_target };

  if (id) {
    const res = await fetch('/api/v1/services/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      closeModal();
      loadSettings();
    } else {
      const err = await res.json();
      alert('保存失败: ' + (err.error || '未知错误'));
    }
  } else {
    const res = await fetch('/api/v1/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      closeModal();
      loadSettings();
    } else {
      const err = await res.json();
      alert('创建失败: ' + (err.error || '未知错误'));
    }
  }
}

async function toggleService(id, enabled) {
  await fetch('/api/v1/services/' + id + '/toggle', { method: 'PATCH' });
  loadSettings();
}

async function deleteServiceConfirm(id, name) {
  if (!confirm('确定删除服务 "' + name + '"？此操作不可撤销。')) return;
  await fetch('/api/v1/services/' + id, { method: 'DELETE' });
  loadSettings();
}

// 点击模态框背景关闭
document.getElementById('service-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// ===================================================
//  Tab 2: 服务状态
// ===================================================

async function loadServicesPage() {
  // 服务列表
  const health = await api('/health');
  const listEl = document.getElementById('services-list');
  if (!health || health.length === 0) {
    listEl.innerHTML = '<div class="empty-state">暂无服务</div>';
    return;
  }

  listEl.innerHTML = health.map(h => `
    <div class="health-row">
      <span class="status-dot ${h.status || 'unknown'}"></span>
      <span class="service-name">${escapeHtml(h.name)}</span>
      <span class="status-badge status-${h.status || 'unknown'}">${h.status || '未知'}</span>
      <span class="service-meta">延迟: ${h.latency_ms != null ? h.latency_ms + 'ms' : '--'}</span>
      <span class="service-meta">上次检查: ${h.timestamp ? formatDateTime(h.timestamp) : '--'}</span>
    </div>
  `).join('');

  // 填充服务选择下拉
  const select = document.getElementById('health-service-select');
  select.innerHTML = '<option value="">选择服务...</option>' +
    health.map(h => `<option value="${h.service_id}">${escapeHtml(h.name)}</option>`).join('');

  refreshIcons();
}

// 服务选择变化时加载健康检查历史
document.getElementById('health-service-select').addEventListener('change', async function() {
  const serviceId = this.value;
  if (!serviceId) {
    document.getElementById('health-timeline').innerHTML = '<div class="empty-state">请选择服务查看健康检查历史</div>';
    return;
  }

  const history = await api('/health/history?service_id=' + serviceId + '&limit=100');
  if (!history || history.length === 0) {
    document.getElementById('health-timeline').innerHTML = '<div class="empty-state">暂无健康检查数据</div>';
    return;
  }

  // 反转时间顺序（API 返回是倒序）
  const data = [...history].reverse();
  const labels = data.map(d => formatDateTime(d.timestamp));
  const latencyValues = data.map(d => d.latency_ms);
  const statusColors = data.map(d => {
    if (d.status === 'healthy') return '#10b981';
    if (d.status === 'degraded') return '#f59e0b';
    return '#ef4444';
  });

  const canvas = document.getElementById('healthTimeline');
  // 创建 canvas（如果不存在）
  const timeline = document.getElementById('health-timeline');
  if (!timeline.querySelector('canvas')) {
    timeline.innerHTML = '<canvas id="healthTimeline" style="width:100%; height:260px;"></canvas>';
  }

  // 销毁旧图表
  if (healthTimelineChart) healthTimelineChart.destroy();

  const ctx = document.getElementById('healthTimeline').getContext('2d');
  healthTimelineChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '延迟 (ms)',
        data: latencyValues,
        backgroundColor: statusColors,
        borderRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'top' } },
      scales: {
        x: { ticks: { maxTicksLimit: 10, font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { font: { size: 11 } }, grid: { color: '#eef0f5' } }
      }
    }
  });
});

// ===================================================
//  Tab 3: 部署状态
// ===================================================

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
      <div class="deploy-sections">
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

async function refreshDeployPage() {
  const grid = document.getElementById('deploy-grid');
  try {
    const res = await fetch('/api/v1/deploy/status');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    grid.innerHTML = (data.services || []).map(renderCard).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (err) {
    console.error('[deploy]', err);
    grid.innerHTML = '<div class="empty-state">加载失败，请刷新重试</div>';
  }
}

// ===================================================
//  全局刷新 & 初始化
// ===================================================

function refreshPage() {
  if (currentTab === 'manage') loadSettings();
  else if (currentTab === 'status') loadServicesPage();
  else if (currentTab === 'deploy') refreshDeployPage();
}

// 根据 URL hash 确定初始 tab
(function init() {
  const hash = window.location.hash.replace('#', '');
  const validTabs = ['manage', 'status', 'deploy'];
  const initialTab = validTabs.includes(hash) ? hash : 'manage';
  switchTab(initialTab);
})();
