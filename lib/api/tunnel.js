const tunnel = require('../tunnel');

// GET /api/v1/tunnel/status
async function getStatus(req, res) {
  try {
    const status = await tunnel.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/v1/tunnel/restart
async function restart(req, res) {
  try {
    const result = await tunnel.restart();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/v1/tunnel/logs?lines=50
async function getLogs(req, res) {
  try {
    const lines = parseInt(req.query.lines, 10) || 50;
    const logs = await tunnel.getLogs(Math.min(lines, 200)); // 最多 200 行
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/v1/tunnel/route
async function addRoute(req, res) {
  const { hostname } = req.body;
  if (!hostname) {
    return res.status(400).json({ error: 'hostname is required' });
  }
  try {
    const result = await tunnel.addRoute(hostname);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getStatus, restart, getLogs, addRoute };
