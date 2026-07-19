/* ===================================================
   WeMonitor — 服务状态页
   =================================================== */

async function loadServicesPage() {
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

  refreshIcons();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function refreshPage() {
  loadServicesPage();
}

loadServicesPage();
