const firewall = require('../firewall');

// GET /api/v1/firewall/status
async function getStatus(req, res) {
  try {
    const result = await firewall.getStatus();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/v1/firewall/rules
async function addRule(req, res) {
  const { port, protocol, comment } = req.body;
  if (!port) {
    return res.status(400).json({ error: 'port is required' });
  }
  try {
    const result = await firewall.addRule({ port, protocol: protocol || 'tcp', comment });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PUT /api/v1/firewall/rules/:number
async function editRule(req, res) {
  const number = parseInt(req.params.number, 10);
  const { port, protocol, comment } = req.body;
  if (isNaN(number)) {
    return res.status(400).json({ error: 'invalid rule number' });
  }
  if (!port) {
    return res.status(400).json({ error: 'port is required' });
  }
  try {
    const result = await firewall.editRule(number, { port, protocol: protocol || 'tcp', comment });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// DELETE /api/v1/firewall/rules/:number
async function deleteRule(req, res) {
  const number = parseInt(req.params.number, 10);
  if (isNaN(number)) {
    return res.status(400).json({ error: 'invalid rule number' });
  }
  try {
    const result = await firewall.deleteRule(number);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getStatus, addRule, editRule, deleteRule };
