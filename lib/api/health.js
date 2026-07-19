const { stmts } = require('../db');

// GET /api/v1/health — 各服务最新健康状态
function getHealthStatus(req, res) {
  const rows = stmts.getLatestHealth.all();
  res.json(rows);
}

module.exports = { getHealthStatus };
