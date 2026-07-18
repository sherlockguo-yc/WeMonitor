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

// 创建 Chart.js 折线图
function createLineChart(canvasId, labels, datasets) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  // 销毁已有图表
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  return new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { boxWidth: 12, padding: 16, font: { size: 12 } }
        }
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 12, font: { size: 11 } },
          grid: { display: false }
        },
        y: {
          ticks: { font: { size: 11 } },
          grid: { color: '#eef0f5' },
          beginAtZero: true
        }
      }
    }
  });
}

// API 请求封装
async function api(path) {
  const res = await fetch('/api/v1' + path);
  if (!res.ok) {
    console.error('API error:', path, res.status);
    return null;
  }
  return res.json();
}

// 窗口级刷新占位
function refreshPage() {}

// 初始化 Lucide 图标（在动态 DOM 改变后调用）
function refreshIcons() {
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}
