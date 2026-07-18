const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'wemonitor.db');

// 确保 data 目录存在
const fs = require('fs');
fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });

const db = new Database(DB_PATH);

// 开启 WAL 模式提升并发读性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 建表
db.exec(`
  CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    labels TEXT DEFAULT '{}',
    value REAL NOT NULL,
    timestamp INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_metrics_lookup
    ON metrics(service, metric_name, timestamp);

  CREATE TABLE IF NOT EXISTS metrics_hourly (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    labels TEXT DEFAULT '{}',
    avg_value REAL NOT NULL,
    min_value REAL NOT NULL,
    max_value REAL NOT NULL,
    count INTEGER NOT NULL,
    hour_ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_metrics_hourly_lookup
    ON metrics_hourly(service, metric_name, hour_ts);
  CREATE INDEX IF NOT EXISTS idx_metrics_hourly_service
    ON metrics_hourly(service, metric_name);

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    scrape_url TEXT,
    scrape_interval INTEGER DEFAULT 30,
    health_type TEXT DEFAULT 'tcp',
    health_target TEXT,
    enabled INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS health_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER REFERENCES services(id),
    status TEXT NOT NULL,
    latency_ms INTEGER,
    message TEXT,
    timestamp INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_health_checks_svc_ts
    ON health_checks(service_id, timestamp);

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
`);

// 兼容旧表迁移：添加 role/status 列
for (const col of ['role', 'status']) {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT NOT NULL DEFAULT '${col === 'role' ? 'user' : 'pending'}'`);
  } catch (_) { /* 列已存在 */ }
}

// 插入默认服务（如果不存在）
const insertService = db.prepare(`
  INSERT OR IGNORE INTO services (name, scrape_url, scrape_interval, health_type, health_target, enabled)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const config = require('../config');
for (const svc of config.defaultServices) {
  insertService.run(svc.name, svc.scrape_url, svc.scrape_interval, svc.health_type, svc.health_target, svc.enabled ? 1 : 0);
}

// 预编译常用语句
const stmts = {
  insertMetric: db.prepare(`
    INSERT INTO metrics (service, metric_name, labels, value, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `),
  insertMetrics: db.transaction((rows) => {
    for (const r of rows) {
      stmts.insertMetric.run(r.service, r.metric_name, r.labels, r.value, r.timestamp);
    }
  }),
  queryMetrics: db.prepare(`
    SELECT service, metric_name, labels, value, timestamp
    FROM metrics
    WHERE service = ? AND metric_name = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
    LIMIT ?
  `),
  queryMetricsHourly: db.prepare(`
    SELECT service, metric_name, labels, avg_value, min_value, max_value, count, hour_ts as timestamp
    FROM metrics_hourly
    WHERE service = ? AND metric_name = ? AND hour_ts >= ? AND hour_ts <= ?
    ORDER BY hour_ts ASC
    LIMIT ?
  `),
  deleteOldMetrics: db.prepare(`
    DELETE FROM metrics WHERE timestamp < ?
  `),
  deleteOldHourly: db.prepare(`
    DELETE FROM metrics_hourly WHERE hour_ts < ?
  `),
  aggregateMetrics: db.prepare(`
    INSERT INTO metrics_hourly (service, metric_name, labels, avg_value, min_value, max_value, count, hour_ts)
    SELECT
      service, metric_name, labels,
      AVG(value), MIN(value), MAX(value), COUNT(*),
      (timestamp / 3600000) * 3600000
    FROM metrics
    WHERE timestamp < ? AND timestamp >= ?
    GROUP BY service, metric_name, labels, (timestamp / 3600000) * 3600000
  `),
  deleteAggregated: db.prepare(`
    DELETE FROM metrics WHERE timestamp < ? AND timestamp >= ?
  `),
  getLatestValue: db.prepare(`
    SELECT value FROM metrics
    WHERE service = ? AND metric_name = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `),
  getLatestValues: db.prepare(`
    SELECT metric_name, value, timestamp FROM metrics
    WHERE service = ? AND metric_name IN (${Array(10).fill('?').join(',')})
    AND timestamp = (SELECT MAX(timestamp) FROM metrics m2 WHERE m2.service = metrics.service AND m2.metric_name = metrics.metric_name)
    GROUP BY metric_name
  `),
  insertHealthCheck: db.prepare(`
    INSERT INTO health_checks (service_id, status, latency_ms, message, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `),
  getLatestHealth: db.prepare(`
    SELECT s.name, s.id as service_id, h.status, h.latency_ms, h.message, h.timestamp
    FROM services s
    LEFT JOIN health_checks h ON h.id = (
      SELECT id FROM health_checks WHERE service_id = s.id ORDER BY timestamp DESC LIMIT 1
    )
    WHERE s.enabled = 1
  `),
  getServiceById: db.prepare(`SELECT * FROM services WHERE id = ?`),
  getServiceByName: db.prepare(`SELECT * FROM services WHERE name = ?`),
  getAllServices: db.prepare(`SELECT * FROM services ORDER BY name`),
  insertServiceFull: db.prepare(`
    INSERT INTO services (name, scrape_url, scrape_interval, health_type, health_target, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  updateService: db.prepare(`
    UPDATE services SET scrape_url = ?, scrape_interval = ?, health_type = ?, health_target = ?, enabled = ?
    WHERE id = ?
  `),
  deleteService: db.prepare(`DELETE FROM services WHERE id = ?`),

  // 用户
  getUserByUsername: db.prepare(`SELECT * FROM users WHERE username = ?`),
  getUserById: db.prepare(`SELECT id, username, role, status, created_at FROM users WHERE id = ?`),
  createUser: db.prepare(`INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, ?, ?)`),
  getAllUsers: db.prepare(`SELECT id, username, role, status, created_at FROM users ORDER BY created_at ASC`),
  approveUser: db.prepare(`UPDATE users SET status = 'active' WHERE id = ?`),
  setRole: db.prepare(`UPDATE users SET role = ? WHERE id = ?`),
  countUsers: db.prepare(`SELECT COUNT(*) as count FROM users`),
  deleteUser: db.prepare(`DELETE FROM users WHERE id = ?`),
};

module.exports = { db, stmts, DB_PATH };
