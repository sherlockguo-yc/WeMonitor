/* ===================================================
   WeMonitor — 服务状态页
   =================================================== */

let healthTimelineChart = null;

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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function refreshPage() {
  loadServicesPage();
}

loadServicesPage();
