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
  // 诊断日志：打印各指标返回的数据量，便于排查后端数据缺失问题
  console.log(`[system] range=${currentRange} api_rows: cpu=${(d.cpu_usage_percent||[]).length} mem=${(d.mem_usage_percent||[]).length} disk=${(d.disk_usage_percent||[]).length} netRx=${(d.net_rx_bytes_sec||[]).length} netTx=${(d.net_tx_bytes_sec||[]).length}`);

  const cpuData   = { data: (d.cpu_usage_percent || []).map(r => ({ timestamp: r.t, value: r.v })) };
  const memData   = { data: (d.mem_usage_percent || []).map(r => ({ timestamp: r.t, value: r.v })) };
  const diskData  = { data: (d.disk_usage_percent || []).map(r => ({ timestamp: r.t, value: r.v, labels: r.l })) };
  const netRxData = { data: (d.net_rx_bytes_sec || []).map(r => ({ timestamp: r.t, value: r.v })) };
  const netTxData = { data: (d.net_tx_bytes_sec || []).map(r => ({ timestamp: r.t, value: r.v })) };

  // 预生成完整时间轴，将 API 数据对齐到槽位（保证 X 轴始终反映选择的完整时间范围）
  const { labels, slotTs } = generateTimeSlots(currentRange);
  // 容差：取间隔的一半，确保每个数据点归入最近的槽位
  const toleranceMs = currentRange === '1h' ? 150000
                   : currentRange === '6h' ? 3600000   // 60 分钟容差，覆盖整点偏移
                   : currentRange === '24h' ? 7200000
                   : 43200000; // 7d

  // 辅助函数：创建图表并处理空数据状态
  function renderChart(canvasId, chartLabel, datasets, yAxisUnit) {
    // 检查是否所有 dataset 的所有数据点都为 null（无有效数据）
    let totalPoints = 0, validPoints = 0;
    for (const ds of datasets) {
      for (const v of ds.data) { totalPoints++; if (v != null) validPoints++; }
    }
    const hasNoData = totalPoints > 0 && validPoints === 0;
    const hasPartialData = validPoints > 0 && validPoints < totalPoints;

    // 缺失数据标记：每个 dataset 追加对应"缺失"圆点（null 位置画灰色圆点，底部）
    const markerDatasets = datasets.map(ds => ({
      label: '', // 不占 legend
      data: ds.data.map(v => v === null ? 0 : null),
      showLine: false,
      pointRadius: 3,
      pointStyle: 'rectRounded',
      pointBackgroundColor: '#d4d4d8',
      pointBorderColor: '#d4d4d8',
    }));

    createLineChart(canvasId, labels, [...datasets, ...markerDatasets], yAxisUnit);

    // 空数据 / 部分数据 UI 提示
    const body = document.getElementById(canvasId)?.closest('.chart-body');
    if (body) {
      let hint = body.querySelector('.chart-empty-hint');
      if (hasNoData && !hint) {
        hint = document.createElement('div');
        hint.className = 'chart-empty-hint';
        hint.innerHTML = `<svg class="icon-md" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg><span>该时间段暂无数据</span>`;
        body.appendChild(hint);
      } else if (!hasNoData && hint) {
        hint.remove();
      }
      // 部分缺失提示
      let missingHint = body.querySelector('.chart-missing-hint');
      if (hasPartialData && !missingHint) {
        missingHint = document.createElement('div');
        missingHint.className = 'chart-missing-hint';
        missingHint.innerHTML = `<svg class="icon-xs" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg><span>${validPoints} / ${totalPoints} 个时间点有数据</span>`;
        body.appendChild(missingHint);
      } else if (!hasPartialData && missingHint) {
        missingHint.remove();
      } else if (hasPartialData && missingHint) {
        missingHint.querySelector('span').textContent = `${validPoints} / ${totalPoints} 个时间点有数据`;
      }
    }

    // 诊断：打印对齐后的有效数据比例
    if (validPoints < totalPoints) {
      console.log(`[system] ${chartLabel}: ${validPoints}/${totalPoints} points valid`);
    }
  }

  // CPU 图
  renderChart('cpuChart', 'CPU', [{
    label: 'CPU %',
    data: alignDataToSlots(cpuData.data, slotTs, toleranceMs),
    borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.08)',
    fill: true, tension: 0.3, pointRadius: 0, spanGaps: false
  }], '%');

  // 内存图
  renderChart('memChart', '内存', [{
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

    renderChart('diskChart', '磁盘', diskDatasets, '%');
  }

  // 网络图
  renderChart('netChart', '网络', [
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
