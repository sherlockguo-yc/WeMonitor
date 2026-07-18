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
  const names = 'cpu_usage_percent,mem_usage_percent,disk_usage_percent,net_rx_bytes_sec,net_tx_bytes_sec';

  const batch = await api('/metrics/batch?names=' + names + '&from=' + range.from + '&to=' + range.to + '&limit=500');
  if (!batch || !batch.data) return;

  const d = batch.data;
  const cpuData   = { data: (d.cpu_usage_percent || []).map(r => ({ timestamp: r.t, value: r.v })) };
  const memData   = { data: (d.mem_usage_percent || []).map(r => ({ timestamp: r.t, value: r.v })) };
  const diskData  = { data: (d.disk_usage_percent || []).map(r => ({ timestamp: r.t, value: r.v, labels: r.l })) };
  const netRxData = { data: (d.net_rx_bytes_sec || []).map(r => ({ timestamp: r.t, value: r.v })) };
  const netTxData = { data: (d.net_tx_bytes_sec || []).map(r => ({ timestamp: r.t, value: r.v })) };

  // 预生成完整时间轴，将 API 数据对齐到槽位（保证 X 轴始终反映选择的完整时间范围）
  const { labels, slotTs } = generateTimeSlots(currentRange);
  // 容差：取间隔的一半，确保每个数据点归入最近的槽位
  const toleranceMs = currentRange === '1h' ? 150000
                   : currentRange === '6h' ? 1800000
                   : currentRange === '24h' ? 7200000
                   : 43200000; // 7d

  // CPU 图
  if (cpuData) createLineChart('cpuChart', labels, [{
    label: 'CPU %',
    data: alignDataToSlots(cpuData.data, slotTs, toleranceMs),
    borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.08)',
    fill: true, tension: 0.3, pointRadius: 0, spanGaps: false
  }], '%');

  // 内存图
  if (memData) createLineChart('memChart', labels, [{
    label: '内存 %',
    data: alignDataToSlots(memData.data, slotTs, toleranceMs),
    borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)',
    fill: true, tension: 0.3, pointRadius: 0, spanGaps: false
  }], '%');

  // 磁盘图（按 mount 分组后分别对齐）
  if (diskData) {
    const diskGroups = {};
    for (const d of diskData.data) {
      const mount = d.labels?.mount || 'unknown';
      if (!diskGroups[mount]) diskGroups[mount] = [];
      diskGroups[mount].push(d);
    }

    const diskDatasets = Object.entries(diskGroups).map(([mount, points], i) => ({
      label: mount,
      data: alignDataToSlots(points, slotTs, toleranceMs),
      borderColor: ['#6366f1', '#f59e0b', '#ef4444', '#10b981'][i % 4],
      fill: false, tension: 0.3, pointRadius: 0, spanGaps: false
    }));

    createLineChart('diskChart', labels, diskDatasets, '%');
  }

  // 网络图
  createLineChart('netChart', labels, [
    {
      label: '\u2193 \u5167\u7ad9',
      data: alignDataToSlots(netRxData?.data || [], slotTs, toleranceMs),
      borderColor: '#10b981', fill: false, tension: 0.3, pointRadius: 0, spanGaps: false
    },
    {
      label: '\u2191 \u51fa\u7ad9',
      data: alignDataToSlots(netTxData?.data || [], slotTs, toleranceMs),
      borderColor: '#f59e0b', fill: false, tension: 0.3, pointRadius: 0, spanGaps: false
    }
  ], 'bytes');
}

function refreshPage() {
  loadCharts();
}

loadCharts();
