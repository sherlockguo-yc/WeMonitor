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
  console.log(`[system] range=${currentRange} api_rows: cpu=${(d.cpu_usage_percent||[]).length} mem=${(d.mem_usage_percent||[]).length} disk=${(d.disk_usage_percent||[]).length} netRx=${(d.net_rx_bytes_sec||[]).length} netTx=${(d.net_tx_bytes_sec||[]).length}`);

  // 数据直接取 timestamp/value，无需槽位/对齐/容差——uPlot 按时间戳原生渲染
  const cpuData  = (d.cpu_usage_percent || []).map(r => ({ t: r.t, v: r.v }));
  const memData  = (d.mem_usage_percent || []).map(r => ({ t: r.t, v: r.v }));
  const diskData = (d.disk_usage_percent || []).map(r => ({ t: r.t, v: r.v, labels: r.l }));
  const netRxData = (d.net_rx_bytes_sec || []).map(r => ({ t: r.t, v: r.v }));
  const netTxData = (d.net_tx_bytes_sec || []).map(r => ({ t: r.t, v: r.v }));

  // 辅助函数：创建图表 + 空数据提示
  function renderChart(containerId, chartLabel, datasets, yAxisOpts) {
    const plot = createTimeChart(containerId, datasets, yAxisOpts);

    // 空数据 / 部分数据提示
    const body = document.getElementById(containerId)?.closest('.chart-body');
    if (!body) return;
    let existing = body.querySelector('.chart-empty-hint, .chart-missing-hint');

    if (datasets.length === 0 || datasets.every(ds => ds.data.length === 0)) {
      if (!existing || !existing.classList.contains('chart-empty-hint')) {
        existing?.remove();
        const el = document.createElement('div');
        el.className = 'chart-empty-hint';
        el.innerHTML = `<svg class="icon-md" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg><span>该时间段暂无数据</span>`;
        body.appendChild(el);
      }
    } else {
      if (existing) existing.remove();
    }
  }

  // CPU
  renderChart('cpuChart', 'CPU', [{
    label: 'CPU %',
    stroke: '#6366f1',
    fill: true,
    data: cpuData,
  }], { unit: '%' });

  // 内存
  renderChart('memChart', '内存', [{
    label: '内存 %',
    stroke: '#10b981',
    fill: true,
    data: memData,
  }], { unit: '%' });

  // 磁盘（按 mount 分组）
  const diskGroups = {};
  for (const d of diskData) {
    const mount = d.labels?.mount || 'unknown';
    if (!diskGroups[mount]) diskGroups[mount] = [];
    diskGroups[mount].push(d);
  }
  const diskDatasets = Object.entries(diskGroups).map(([mount, points], i) => ({
    label: mount,
    stroke: ['#6366f1', '#f59e0b', '#ef4444', '#10b981'][i % 4],
    fill: false,
    data: points,
  }));
  renderChart('diskChart', '磁盘', diskDatasets, { unit: '%' });

  // 网络
  renderChart('netChart', '网络', [
    { label: '↓ 入站', stroke: '#10b981', fill: false, data: netRxData },
    { label: '↑ 出站', stroke: '#f59e0b', fill: false, data: netTxData },
  ], { unit: 'bytes' });
}

function refreshPage() {
  loadCharts();
}

loadCharts();
