/* ===================================================
   WeMonitor — 概览页
   =================================================== */

async function loadDashboard() {
  const t0 = performance.now();

  const [stats, health] = await Promise.all([
    api('/stats/current'),
    api('/health')
  ]);

  // 渲染卡片（不等待图表）
  if (stats) {
    document.getElementById('cpu-value').textContent = formatPercent(stats.cpu_usage_percent);
    document.getElementById('mem-value').textContent = formatPercent(stats.mem_usage_percent);
    document.getElementById('mem-detail').textContent =
      (stats.mem_used_gb || 0).toFixed(1) + ' GB / ' + (stats.mem_total_gb || 0).toFixed(1) + ' GB';

    const rootDisk = stats.disks?.find(d => d.labels?.mount === '/') || stats.disks?.[0];
    if (rootDisk) {
      document.getElementById('disk-value').textContent = formatPercent(rootDisk.value);
    }
    const realDisks = (stats.disks || []).filter(d => d.labels?.fs !== 'efivarfs');
    document.getElementById('disk-detail').textContent = realDisks.map(d =>
      (d.labels?.mount || '?') + ': ' + formatPercent(d.value)
    ).join(' · ') || '';

    document.getElementById('net-value').textContent =
      formatBytes(stats.net_rx_bytes_sec) + '/s';
    document.getElementById('net-detail').textContent =
      '↓ ' + formatBytes(stats.net_rx_bytes_sec) + '/s  ↑ ' + formatBytes(stats.net_tx_bytes_sec) + '/s';
  }

  // 渲染健康列表
  renderHealthList(health);

  const totalMs = Math.round(performance.now() - t0);
  console.log(`[client] loadDashboard total=${totalMs}ms`);
}

function renderHealthList(health) {
  const container = document.getElementById('health-list');
  if (!health || health.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无服务</div>';
    return;
  }
  container.innerHTML = health.map(h => `
    <div class="health-row">
      <span class="status-dot ${h.status || 'unknown'}"></span>
      <span class="service-name">${escapeHtml(h.name)}</span>
      <span class="status-badge status-${h.status || 'unknown'}">${h.status || '未知'}</span>
      <span class="service-meta">${h.latency_ms != null ? h.latency_ms + 'ms' : '--'}</span>
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
  loadDashboard();
}

loadDashboard();
