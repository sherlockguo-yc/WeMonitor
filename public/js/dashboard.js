/* ===================================================
   WeMonitor — 概览页
   =================================================== */

let trendChart = null;
let currentRange = '1h';

// 标签页切换
document.querySelectorAll('#trend-tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('#trend-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentRange = tab.dataset.range;
    loadTrendChart();
  });
});

async function loadDashboard() {
  // 获取实时系统状态
  const stats = await api('/stats/current');
  if (stats) {
    document.getElementById('cpu-value').textContent = formatPercent(stats.cpu_usage_percent);
    document.getElementById('mem-value').textContent = formatPercent(stats.mem_usage_percent);
    document.getElementById('mem-detail').textContent =
      (stats.mem_used_gb || 0).toFixed(1) + ' GB / ' + (stats.mem_total_gb || 0).toFixed(1) + ' GB';

    // 取根分区的磁盘使用率
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

  // 趋势图
  loadTrendChart();

  // 健康状态
  loadHealthList();
}

async function loadTrendChart() {
  const range = getTimeRange(currentRange);
  const [cpuData, memData] = await Promise.all([
    api('/metrics?service=system&metric_name=cpu_usage_percent&from=' + range.from + '&to=' + range.to + '&limit=500'),
    api('/metrics?service=system&metric_name=mem_usage_percent&from=' + range.from + '&to=' + range.to + '&limit=500')
  ]);

  const timeFmt = currentRange === '7d' ? formatDateTime : formatTime;
  const labels = cpuData?.data?.map(d => timeFmt(d.timestamp)) || [];
  const cpuValues = cpuData?.data?.map(d => d.value) || [];
  const memValues = memData?.data?.map(d => d.value) || [];

  trendChart = createLineChart('trendChart', labels, [
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
  ]);
}

async function loadHealthList() {
  const health = await api('/health');
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

// 重写全局刷新
function refreshPage() {
  loadDashboard();
}

// 页面加载
loadDashboard();
