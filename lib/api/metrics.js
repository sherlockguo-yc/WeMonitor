const { db, stmts } = require('../db');

// GET /api/v1/metrics — 查询指标数据
function queryMetrics(req, res) {
  const { service, metric_name, from, to, limit } = req.query;
  const fromTs = from ? parseInt(from, 10) : Date.now() - 3600000;
  const toTs = to ? parseInt(to, 10) : Date.now();
  const maxRows = Math.min(parseInt(limit) || 5000, 20000);

  if (!service || !metric_name) {
    return res.status(400).json({ error: 'service and metric_name are required' });
  }

  // 1 分钟粒度数据只保留 1 小时（cleaner 会聚合到小时表）
  // 超过 1 小时的查询走小时聚合表
  const rangeMs = toTs - fromTs;
  let rows;
  if (rangeMs > 3600000) {
    rows = stmts.queryMetricsHourly.all(
      service, metric_name,
      Math.floor(fromTs / 1000), Math.floor(toTs / 1000),
      maxRows
    ).map(r => ({ ...r, value: r.avg_value, timestamp: r.timestamp * 1000 }));
  } else {
    rows = stmts.queryMetrics.all(service, metric_name, fromTs, toTs, maxRows);
  }

  // 解析 labels JSON
  rows = rows.map(r => ({ ...r, labels: safeJsonParse(r.labels) }));

  res.json({ service, metric_name, count: rows.length, data: rows });
}

// POST /api/v1/metrics — Push 上报指标
function pushMetrics(req, res) {
  const { apiKey } = require('../../config');

  // API Key 鉴权
  const authKey = req.headers['x-api-key'];
  if (!authKey || authKey !== apiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  const { service, metrics } = req.body;
  if (!service || !metrics || !Array.isArray(metrics)) {
    return res.status(400).json({ error: 'service (string) and metrics (array) are required' });
  }

  const now = Date.now();
  const rows = [];
  for (const m of metrics) {
    if (!m.name || m.value == null) continue;
    rows.push({
      service,
      metric_name: m.name,
      labels: m.labels ? JSON.stringify(m.labels) : '{}',
      value: m.value,
      timestamp: m.timestamp || now
    });
  }

  if (rows.length > 0) {
    stmts.insertMetrics(rows);
  }

  res.json({ accepted: rows.length });
}

// GET /api/v1/stats/current — 当前实时系统状态
function getCurrentStats(req, res) {
  const metricNames = [
    'cpu_usage_percent', 'mem_usage_percent', 'mem_total_gb', 'mem_used_gb',
    'net_rx_bytes_sec', 'net_tx_bytes_sec', 'load_1m', 'cpu_temp_celsius', 'uptime_seconds'
  ];

  const result = {};
  for (const name of metricNames) {
    const row = stmts.getLatestValue.get('system', name);
    result[name] = row ? row.value : null;
  }

  // 磁盘
  const diskRows = db.prepare(`
    SELECT labels, value FROM metrics
    WHERE service = 'system' AND metric_name = 'disk_usage_percent'
    AND timestamp = (SELECT MAX(timestamp) FROM metrics m2 WHERE m2.service = 'system' AND m2.metric_name = 'disk_usage_percent')
  `).all();
  result.disks = diskRows.map(r => ({ ...r, labels: safeJsonParse(r.labels) }));

  res.json(result);
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch (_) { return {}; }
}

module.exports = { queryMetrics, pushMetrics, getCurrentStats };
