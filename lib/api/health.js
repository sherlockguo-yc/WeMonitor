const { stmts } = require('../db');

// GET /api/v1/health — 各服务最新健康状态
function getHealthStatus(req, res) {
  const rows = stmts.getLatestHealth.all();
  res.json(rows);
}

// GET /api/v1/health/history — 某服务健康检查历史
function getHealthHistory(req, res) {
  const { service_id, limit } = req.query;
  if (!service_id) {
    return res.status(400).json({ error: 'service_id is required' });
  }
  const maxRows = Math.min(parseInt(limit) || 200, 1000);
  const rows = stmts.db.prepare(`
    SELECT * FROM health_checks
    WHERE service_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(parseInt(service_id, 10), maxRows);
  res.json(rows);
}

module.exports = { getHealthStatus, getHealthHistory };
