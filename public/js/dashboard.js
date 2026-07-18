/* ===================================================
   WeMonitor — 概览页
   =================================================== */

let currentRange = '1h';

// 标签页切换
document.querySelectorAll('#trend-tabs .tab').forEach(tab => {
  tab.addEventListener('click', function() {
    if (this.classList.contains('active')) return;
    document.querySelectorAll('#trend-tabs .tab').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
    currentRange = this.dataset.range;
    loadTrendChart();
  });
});

async function loadDashboard() {
  const t0 = performance.now();

  // 并行请求：stats + trendChart 数据 + health，互不依赖
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

  // 异步渲染健康列表
  renderHealthList(health);

  // 异步加载趋势图
  loadTrendChart();

  const totalMs = Math.round(performance.now() - t0);
  console.log(`[client] loadDashboard total=${totalMs}ms (render immediately, chart loads async)`);
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

async function loadTrendChart() {
  const range = getTimeRange(currentRange);
  const batch = await api('/metrics/batch?names=cpu_usage_percent,mem_usage_percent&from=' + range.from + '&to=' + range.to + '&limit=500');
  if (!batch || !batch.data) return;

  const timeFmt = currentRange === '7d' ? formatDateTime : formatTime;
  const cpu = batch.data.cpu_usage_percent || [];
  const mem = batch.data.mem_usage_percent || [];
  const labels = cpu.map(d => timeFmt(d.t));
  const cpuValues = cpu.map(d => d.v);
  const memValues = mem.map(d => d.v);

  createLineChart('trendChart', labels, [
    {
      label: 'CPU %',
      data: cpuValues,
      borderColor: '#6366f1',
      backgroundColor: 'rgba(99,102,241,0.08)',
      fill: true,
      tension: 0.3,
      pointRadius: 0
    },
    {
      label: '内存 %',
      data: memValues,
      borderColor: '#10b981',
      backgroundColor: 'rgba(16,185,129,0.08)',
      fill: true,
      tension: 0.3,
      pointRadius: 0
    }
  ], '%');
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
