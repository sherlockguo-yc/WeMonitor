const tunnel = require('../tunnel');

// 缓存 — 30 秒内直接返回，避免每次 1.5s 命令开销
let _cache = null;
let _cacheTime = 0;

// GET /api/v1/tunnel/status
async function getStatus(req, res) {
  try {
    const now = Date.now();
    if (_cache && (now - _cacheTime < 30000)) {
      console.log('[perf] tunnel/status cache hit');
      return res.json(_cache);
    }
    const t0 = Date.now();
    const status = await tunnel.getStatus();
    console.log(`[perf] tunnel/status real ${Date.now() - t0}ms`);
    _cache = status;
    _cacheTime = now;
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

// GET /api/v1/tunnel/routes
async function getRoutes(req, res) {
  try {
    const result = await tunnel.getRoutes();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getStatus, restart, getLogs, addRoute, getRoutes };
