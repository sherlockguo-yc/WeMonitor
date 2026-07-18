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

// chart 实例 registry，用于避免画布复用问题
const _chartInstances = {};

// 创建或更新 Chart.js 折线图
// yAxisUnit: '%' → 百分比单位, 'bytes' → B/KB/MB/GB + /s, 不传 → 原始数值
function createLineChart(canvasId, labels, datasets, yAxisUnit) {
  if (typeof Chart === 'undefined') return null;

  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  // 销毁旧实例 + 重建 canvas 避免 Chart.js 画布复用问题
  const prev = _chartInstances[canvasId];
  if (prev) {
    prev.destroy();
    delete _chartInstances[canvasId];
  }

  // 替换 canvas 确保全新渲染
  const newCanvas = document.createElement('canvas');
  newCanvas.id = canvasId;
  newCanvas.style.cssText = canvas.style.cssText || 'width:100%; height:260px;';
  canvas.parentNode.replaceChild(newCanvas, canvas);

  // Y 轴刻度格式化
  const yTickCallback = yAxisUnit === '%'
    ? (v) => v.toFixed(0) + '%'
    : yAxisUnit === 'bytes'
    ? (v) => formatBytes(v) + '/s'
    : undefined;

  const chart = new Chart(newCanvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { boxWidth: 12, padding: 16, font: { size: 12 } }
        }
      },
      scales: {
        x: {
          ticks: { autoSkip: true, maxTicksLimit: 8, font: { size: 11 } },
          grid: { display: false }
        },
        y: {
          ticks: {
            font: { size: 11 },
            callback: yTickCallback
          },
          grid: { color: '#eef0f5' },
          beginAtZero: true,
          ...(yAxisUnit === '%' ? { max: 100 } : {})
        }
      }
    }
  });

  _chartInstances[canvasId] = chart;
  return chart;
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
