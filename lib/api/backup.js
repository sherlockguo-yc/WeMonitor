/**
 * 数据备份管理 API
 * - 列出所有备份目标及其备份状态
 * - 开关某个目标的 R2 备份
 *
 * 注意 backup_config.service_name 上有外键指向 services(name)，所以「备份目标」
 * 必须先在 services 表里存在。这带来一个概念混用：services 表里既有「被监控的服务」，
 * 也可能有「只是需要一个 data 目录被备份」的条目（例如 we-auth 的共享用户库
 * ~/shared/data）。这类条目没有 health_target，因此不参与健康检查与指标抓取。
 *
 * 为了让 UI 不把它显示成「已停用的服务」，这里额外返回 monitored 标志
 * （= 是否有 health_target），由前端决定文案。
 */
const { db } = require('../db');

function listBackupServices(req, res) {
  const rows = db.prepare(`
    SELECT s.name, s.enabled AS service_enabled, s.health_target,
           COALESCE(b.enabled, 0) AS backup_enabled,
           b.last_backup_at, b.last_backup_size, b.r2_path
    FROM services s
    LEFT JOIN backup_config b ON s.name = b.service_name COLLATE NOCASE
    ORDER BY s.name
  `).all();

  res.json({
    services: rows.map((r) => ({
      ...r,
      backup_enabled: !!r.backup_enabled,
      service_enabled: !!r.service_enabled,
      monitored: !!r.health_target,
      last_backup_at: r.last_backup_at || null,
      last_backup_size: r.last_backup_size || null,
      r2_path: r.r2_path || 'n150-backups/' + r.name + '/daily/',
    })),
  });
}

function toggleBackup(req, res) {
  const { name } = req.params;
  if (!name) return res.status(400).json({ error: '缺少服务名' });

  const svc = db.prepare('SELECT * FROM services WHERE name = ? COLLATE NOCASE').get(name);
  if (!svc) return res.status(404).json({ error: '服务不存在' });

  const svcName = svc.name; // services 表的正确大小写

  const existing = db.prepare('SELECT * FROM backup_config WHERE service_name = ? COLLATE NOCASE').get(name);
  if (!existing) {
    db.prepare('INSERT INTO backup_config (service_name, enabled) VALUES (?, 1)').run(svcName);
    return res.json({ name: svcName, backup_enabled: true });
  }
  const newState = existing.enabled ? 0 : 1;
  db.prepare('UPDATE backup_config SET enabled = ?, service_name = ? WHERE service_name = ? COLLATE NOCASE').run(newState, svcName, name);
  res.json({ name: svcName, backup_enabled: !!newState });
}

module.exports = { listBackupServices, toggleBackup };
