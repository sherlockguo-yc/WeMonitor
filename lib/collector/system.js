const si = require('systeminformation');
const { stmts } = require('../db');

let cpuPrev = null;

async function collect() {
  const now = Date.now();
  const service = 'system';
  const rows = [];

  // CPU 使用率（需要两次采样）
  const cpuLoad = await si.currentLoad();
  rows.push({ service, metric_name: 'cpu_usage_percent', labels: '{}', value: cpuLoad.currentLoad, timestamp: now });

  // 内存
  const mem = await si.mem();
  rows.push({ service, metric_name: 'mem_total_gb', labels: '{}', value: mem.total / 1024 / 1024 / 1024, timestamp: now });
  rows.push({ service, metric_name: 'mem_used_gb', labels: '{}', value: mem.used / 1024 / 1024 / 1024, timestamp: now });
  rows.push({ service, metric_name: 'mem_usage_percent', labels: '{}', value: (mem.used / mem.total) * 100, timestamp: now });

  // 磁盘
  const fsSize = await si.fsSize();
  for (const fs of fsSize) {
    const labels = JSON.stringify({ mount: fs.mount, fs: fs.fs });
    rows.push({ service, metric_name: 'disk_total_gb', labels, value: fs.size / 1024 / 1024 / 1024, timestamp: now });
    rows.push({ service, metric_name: 'disk_used_gb', labels, value: fs.used / 1024 / 1024 / 1024, timestamp: now });
    rows.push({ service, metric_name: 'disk_usage_percent', labels, value: fs.use, timestamp: now });
  }

  // 网络 IO
  const netStats = await si.networkStats();
  let totalRx = 0, totalTx = 0;
  for (const iface of netStats) {
    if (iface.iface !== 'lo') {
      totalRx += iface.rx_sec;
      totalTx += iface.tx_sec;
    }
  }
  rows.push({ service, metric_name: 'net_rx_bytes_sec', labels: '{}', value: totalRx, timestamp: now });
  rows.push({ service, metric_name: 'net_tx_bytes_sec', labels: '{}', value: totalTx, timestamp: now });

  // 系统负载
  const load = await si.currentLoad();
  rows.push({ service, metric_name: 'load_1m', labels: '{}', value: cpuLoad.avgLoad, timestamp: now });

  // CPU 温度（如果可用）
  try {
    const temp = await si.cpuTemperature();
    if (temp.main != null && temp.main !== -1) {
      rows.push({ service, metric_name: 'cpu_temp_celsius', labels: '{}', value: temp.main, timestamp: now });
    }
  } catch (_) { /* 部分机器不支持温度传感器 */ }

  // 运行时间
  const time = si.time();
  rows.push({ service, metric_name: 'uptime_seconds', labels: '{}', value: time.uptime, timestamp: now });

  // 批量写入
  stmts.insertMetrics(rows);

  return rows;
}

module.exports = { collect };
