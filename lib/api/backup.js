/**
 * 数据备份管理 API
 * - 列出所有服务及其备份状态
 * - 开关某个服务的 R2 备份
 */
const { db } = require('../db');

function listBackupServices(req, res) {
  const rows = db.prepare(`
    SELECT s.name, s.enabled AS service_enabled,
           COALESCE(b.enabled, 0) AS backup_enabled,
           b.last_backup_at, b.last_backup_size, b.r2_path
    FROM services s
    LEFT JOIN backup_config b ON s.name = b.service_name
    ORDER BY s.name
  `).all();

  res.json({
    services: rows.map((r) => ({
      ...r,
      backup_enabled: !!r.backup_enabled,
      service_enabled: !!r.service_enabled,
      last_backup_at: r.last_backup_at || null,
      last_backup_size: r.last_backup_size || null,
      r2_path: r.r2_path || 'n150-backups/' + r.name + '/daily/',
    })),
  });
}

function toggleBackup(req, res) {
  const { name } = req.params;
  if (!name) return res.status(400).json({ error: '缺少服务名' });

  const svc = db.prepare('SELECT * FROM services WHERE name = ?').get(name);
  if (!svc) return res.status(404).json({ error: '服务不存在' });

  const existing = db.prepare('SELECT * FROM backup_config WHERE service_name = ?').get(name);
  if (!existing) {
    db.prepare('INSERT INTO backup_config (service_name, enabled) VALUES (?, 1)').run(name);
    return res.json({ name, backup_enabled: true });
  }
  const newState = existing.enabled ? 0 : 1;
  db.prepare('UPDATE backup_config SET enabled = ? WHERE service_name = ?').run(newState, name);
  res.json({ name, backup_enabled: !!newState });
}

module.exports = { listBackupServices, toggleBackup };
