/* ===================================================
   WeMonitor — 公共工具函数
   =================================================== */

// 格式化字节数
function formatBytes(bytes) {
  if (bytes == null) return '--';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes.toFixed(0) + ' B';
}

// 格式化百分比
function formatPercent(val) {
  if (val == null) return '--';
  return val.toFixed(1) + '%';
}

// 格式化时间戳为 HH:MM
function formatTime(ts) {
  const d = new Date(ts);
  return d.getHours().toString().padStart(2, '0') + ':' +
         d.getMinutes().toString().padStart(2, '0');
}

// 格式化时间戳为 MM-DD HH:MM
function formatDateTime(ts) {
  const d = new Date(ts);
  return (d.getMonth() + 1).toString().padStart(2, '0') + '-' +
         d.getDate().toString().padStart(2, '0') + ' ' +
         d.getHours().toString().padStart(2, '0') + ':' +
         d.getMinutes().toString().padStart(2, '0');
}

// 格式化秒数为可读时间
function formatUptime(sec) {
  if (sec == null) return '--';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return d + ' 天 ' + h + ' 小时';
  if (h > 0) return h + ' 小时 ' + m + ' 分';
  return m + ' 分钟';
}

// 获取时间范围 Unix 毫秒时间戳
function getTimeRange(range) {
  const now = Date.now();
  switch (range) {
    case '1h': return { from: now - 3600000, to: now };
    case '6h': return { from: now - 21600000, to: now };
    case '24h': return { from: now - 86400000, to: now };
    case '7d': return { from: now - 604800000, to: now };
    default: return { from: now - 3600000, to: now };
  }
}

// 根据时间范围生成完整 X 轴时间槽位（已弃用，uPlot 原生支持时间轴）
function generateTimeSlots(range) {
  // 保留此函数避免 ReferenceError，功能由 uPlot 时间轴替代
  return { labels: [], slotTs: [] };
}

// 将 API 返回的数据点对齐到时间槽位（已弃用，uPlot 按时间戳直接绘制）
function alignDataToSlots(apiData, slotTs, toleranceMs) {
  // 保留此函数避免 ReferenceError，功能由 uPlot 替代
  return apiData.map(d => d.value);
}

// ===================================================
// uPlot 时间序列图表
// ===================================================

// 图表实例缓存
const _chartInstances = {};

// 创建 uPlot 时间序列折线图
// datasets: [{ label, stroke, fill, data: [{t: ms, v: number}, ...] }, ...]
// yAxisOpts: { unit: '%' | 'bytes' } 或不传
function createTimeChart(containerId, datasets, yAxisOpts = {}) {
  if (typeof uPlot === 'undefined') {
    console.error('[uPlot] uPlot global not defined, chart creation aborted');
    return null;
  }

  const container = document.getElementById(containerId);
  if (!container) return null;

  // 销毁旧实例
  if (_chartInstances[containerId]) {
    _chartInstances[containerId].destroy();
    delete _chartInstances[containerId];
  }

  // 取所有数据集的时间戳合集（去重排序，作为 X 轴）
  // uPlot time scale 使用 Unix 秒（不是毫秒），需要 /1000
  const tsSet = new Set();
  for (const ds of datasets) {
    for (const p of ds.data) tsSet.add(p.t);
  }
  const timestamps = [...tsSet].sort((a, b) => a - b).map(t => Math.floor(t / 1000));

  // 构建 uPlot 列数据：第 0 列时间戳，后续每列一个 series
  const cols = [timestamps];
  for (const ds of datasets) {
    const valMap = new Map(ds.data.map(p => [p.t, p.v]));
    const tMap = new Map(ds.data.map(p => [Math.floor(p.t / 1000), p.v]));
    cols.push(timestamps.map(t => tMap.has(t) ? tMap.get(t) : null));
  }

  // 颜色转 rgba（用于填充透明叠加）
  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // 构建 series 配置
  const series = [
    {}, // x 轴：时间
    ...datasets.map(ds => ({
      label: ds.label,
      stroke: ds.stroke || '#6366f1',
      fill: ds.fill ? hexToRgba(ds.stroke || '#6366f1', 0.25) : undefined,
      width: 2.5,
      points: { show: false },
      spanGaps: false,
    }))
  ];

  // Y 轴值格式化
  let yValues;
  if (yAxisOpts.unit === '%') {
    yValues = (u, vals) => vals.map(v => v == null ? '—' : v.toFixed(0) + '%');
  } else if (yAxisOpts.unit === 'bytes') {
    yValues = (u, vals) => vals.map(v => v == null ? '—' : formatBytes(v) + '/s');
  }

  // X 轴时间格式：1h 范围用 HH:MM，6h/24h 用 HH:MM（同日）或 MM/DD HH:MM（跨日），7d 用 MM/DD
  const xValues = (u, vals) => {
    if (!vals || vals.length === 0) return [];
    const range = (vals[vals.length - 1] - vals[0]) * 1000; // s → ms
    const dayMs = 86400000;
    return vals.map(v => {
      const d = new Date(v * 1000);
      const HH = String(d.getHours()).padStart(2, '0');
      const MM = String(d.getMinutes()).padStart(2, '0');
      const MD = `${d.getMonth() + 1}/${d.getDate()}`;
      if (range < dayMs) return `${HH}:${MM}`;           // < 1 天：HH:MM
      if (range < 7 * dayMs) return `${MD} ${HH}:${MM}`; // < 1 周：MM/DD HH:MM
      return MD;                                          // >= 1 周：MM/DD
    });
  };

  // 创建鼠标悬浮 tooltip 元素（每个容器只能有一个）
  let tt = container.querySelector('.u-tooltip');
  if (!tt) {
    tt = document.createElement('div');
    tt.className = 'u-tooltip';
  }

  const opts = {
    width: container.offsetWidth || 800,
    height: 260,
    cursor: {
      show: true,
      x: true,
      y: false,
    },
    legend: { show: true, live: false },
    scales: {
      x: { time: true },
      y: {
        range: yAxisOpts.unit === '%' ? [0, 100] : undefined,
      }
    },
    axes: [
      {
        stroke: '#71717a',
        grid: { show: false },
        ticks: { show: false },
        values: xValues,
        font: '11px var(--font)',
      },
      {
        stroke: '#71717a',
        grid: { stroke: '#f0f0f5', width: 1 },
        values: yValues,
        font: '11px var(--font)',
      }
    ],
    series,
    hooks: {
      setCursor: [u => {
        const { left, top, idx } = u.cursor;
        if (idx == null || left < 0 || top < 0) { tt.style.display = 'none'; return; }

        const t = u.data[0][idx];
        const d = new Date(t * 1000);
        const timeStr = `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

        // 格式化某个系列的值
        const fmtVal = (v) => {
          if (v == null) return '—';
          if (yAxisOpts.unit === '%') return v.toFixed(1) + '%';
          if (yAxisOpts.unit === 'bytes') return formatBytes(v) + '/s';
          return v.toFixed(1);
        };

        let html = `<div class="u-tt-time">${timeStr}</div>`;
        for (let i = 1; i < u.series.length; i++) {
          const v = u.data[i][idx];
          const label = u.series[i].label || '';
          const stroke = u.series[i].stroke || '#6366f1';
          html += `<div class="u-tt-row">
            <span class="u-tt-marker" style="background:${stroke}"></span>
            <span class="u-tt-label">${label}</span>
            <span class="u-tt-val">${fmtVal(v)}</span>
          </div>`;
        }

        tt.innerHTML = html;
        tt.style.display = 'block';

        // 定位 tooltip（容器内绝对坐标，避免溢出）
        const over = u.over;
        const bbox = over.getBoundingClientRect();
        const relLeft = left - bbox.left;
        const relTop = top - bbox.top;
        const ttW = tt.offsetWidth || 140;
        const ttH = tt.offsetHeight || 60;
        let l = relLeft + 14;
        let tPos = relTop - ttH - 10;
        if (l + ttW > bbox.width - 4) l = relLeft - ttW - 10;
        if (tPos < 4) tPos = relTop + 14;
        tt.style.left = l + 'px';
        tt.style.top = tPos + 'px';
      }]
    },
  };

  try {
    console.log(`[uPlot] ${containerId} creating: container=${container.offsetWidth}x${container.offsetHeight}, cols=${cols.length}, ts=${timestamps.length}`);
    const plot = new uPlot(opts, cols, container);
    _chartInstances[containerId] = plot;
    // tooltip 必须在 uPlot 创建之后插入，避免干扰构造函数内部 DOM 操作
    if (!tt.parentNode) container.appendChild(tt);
    console.log(`[uPlot] ${containerId} created OK`);
    return plot;
  } catch (e) {
    console.error(`[uPlot] ${containerId} ERROR:`, e.message, e.stack);
    container.innerHTML = `<div style="color:var(--danger);padding:1em;">图表渲染失败: ${e.message}</div>`;
    return null;
  }
}

// 创建 Chart.js 折线图（已弃用，保留空实现避免 ReferenceError）
function createLineChart(canvasId, labels, datasets, yAxisUnit) {
  // 兼容旧调用方
  return null;
}

// 前端缓存 — 避免切换 Tab 时重复请求相同数据
const _cache = {};
const CACHE_TTL = {
  default: 30000,           // 30s
  '/stats/current': 30000,
  '/metrics/batch': 60000,
  '/health': 60000,
  '/services': 120000,
  '/firewall/status': 60000,
  '/admin/users': 120000,
  '/tunnel/status': 30000,
  '/tunnel/logs': 30000,
};

function _getTTL(path) {
  // 去掉 query string 取基础路径
  const base = path.split('?')[0];
  return CACHE_TTL[base] || CACHE_TTL.default;
}

// API 请求封装（自动注入 auth cookie，带前端缓存）
async function api(path, opts = {}) {
  const cacheKey = '/api/v1' + path;
  const ttl = _getTTL(path);
  const cached = _cache[cacheKey];

  // 命中缓存 → 立即返回
  if (cached && (Date.now() - cached.time < ttl) && !opts.skipCache) {
    console.log(`[client] ${path} cache hit`);
    return cached.data;
  }

  const t0 = performance.now();
  try {
    const res = await fetch(cacheKey);
    const fetchMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      if (res.status === 401) {
        window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
        return null;
      }
      console.error('API error:', path, res.status);
      return null;
    }
    const data = await res.json();
    if (fetchMs > 200 || (data._perf && data._perf.dbMs > 50)) {
      console.log(`[client] ${path} fetch=${fetchMs}ms db=${data._perf?.dbMs || '?'}ms rows=${data.count || '?'} ${cached ? 'stale' : 'fresh'}`);
    }
    // 存入缓存
    _cache[cacheKey] = { data, time: Date.now() };
    return data;
  } catch (err) {
    // 网络错误时返回过期缓存
    if (cached) {
      console.warn(`[client] ${path} fetch failed, using stale cache`);
      return cached.data;
    }
    return null;
  }
}

// 窗口级刷新占位
function refreshPage() {}

// 初始化 Lucide 图标（在动态 DOM 改变后调用）
function refreshIcons() {
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}
