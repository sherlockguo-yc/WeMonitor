/* ===================================================
   WeMonitor — 系统资源页
   =================================================== */

let currentRange = '1h';

// 标签页切换
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', function() {
    if (this.classList.contains('active')) return;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
    currentRange = this.dataset.range;
    loadCharts();
  });
});

async function loadCharts() {
  const range = getTimeRange(currentRange);
  const metricNames = ['cpu_usage_percent', 'mem_usage_percent', 'disk_usage_percent', 'net_rx_bytes_sec', 'net_tx_bytes_sec'];

  const results = await Promise.all(
    metricNames.map(name =>
      api('/metrics?service=system&metric_name=' + name + '&from=' + range.from + '&to=' + range.to + '&limit=500')
    )
  );

  const cpuData = results[0];
  const memData = results[1];
  const diskData = results[2];
  const netRxData = results[3];
  const netTxData = results[4];

  const timeFmt = currentRange === '7d' ? formatDateTime : formatTime;

  // CPU 图
  if (cpuData) {
    createLineChart('cpuChart',
      cpuData.data.map(d => timeFmt(d.timestamp)),
      [{
        label: 'CPU %',
        data: cpuData.data.map(d => d.value),
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99,102,241,0.08)',
        fill: true, tension: 0.3, pointRadius: 0
      }]
    );
  }

  // 内存图
  if (memData) {
    createLineChart('memChart',
      memData.data.map(d => timeFmt(d.timestamp)),
      [{
        label: '内存 %',
        data: memData.data.map(d => d.value),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16,185,129,0.08)',
        fill: true, tension: 0.3, pointRadius: 0
      }]
    );
  }

  // 磁盘图
  if (diskData) {
    const diskGroups = {};
    for (const d of diskData.data) {
      const mount = d.labels?.mount || 'unknown';
      if (!diskGroups[mount]) diskGroups[mount] = [];
      diskGroups[mount].push(d);
    }

    const diskLabels = Object.values(diskGroups)[0]?.map(d => timeFmt(d.timestamp)) || [];
    const diskDatasets = Object.entries(diskGroups).map(([mount, points], i) => ({
      label: mount,
      data: points.map(p => p.value),
      borderColor: ['#6366f1', '#f59e0b', '#ef4444', '#10b981'][i % 4],
      fill: false, tension: 0.3, pointRadius: 0
    }));

    createLineChart('diskChart', diskLabels, diskDatasets);
  }

  // 网络图
  const netLabels = netRxData?.data?.map(d => timeFmt(d.timestamp)) || [];
  createLineChart('netChart', netLabels, [
    {
      label: '↓ 入站',
      data: netRxData?.data?.map(d => d.value) || [],
      borderColor: '#10b981',
      fill: false, tension: 0.3, pointRadius: 0
    },
    {
      label: '↑ 出站',
      data: netTxData?.data?.map(d => d.value) || [],
      borderColor: '#f59e0b',
      fill: false, tension: 0.3, pointRadius: 0
    }
  ]);
}

function refreshPage() {
  loadCharts();
}

loadCharts();
