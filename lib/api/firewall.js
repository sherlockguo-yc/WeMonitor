const firewall = require('../firewall');

// IP/CIDR 格式校验：支持 IPv4、IPv6、CIDR，空值或 any 表示不限制来源
function isValidIpOrCidr(value) {
  if (!value || value === 'any' || value === 'Anywhere') return true;
  // CIDR 格式: x.x.x.x/n 或 x:x:x:x/n
  const cidrMatch = value.match(/^(.+?)\/(\d+)$/);
  let ip = value, mask = -1;
  if (cidrMatch) {
    ip = cidrMatch[1];
    mask = parseInt(cidrMatch[2], 10);
  }
  // IPv4
  const ipv4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const ok = ipv4.slice(1).every(o => parseInt(o, 10) <= 255);
    if (!ok) return false;
    if (mask >= 0) return mask >= 0 && mask <= 32;
    return true;
  }
  // IPv6（简化校验）
  const ipv6 = ip.match(/^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/);
  if (ipv6) {
    if (mask >= 0) return mask >= 0 && mask <= 128;
    return true;
  }
  return false;
}

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
  const { port, protocol, comment, from } = req.body;
  if (!port) {
    return res.status(400).json({ error: 'port is required' });
  }
  if (from && !isValidIpOrCidr(from)) {
    return res.status(400).json({ error: '无效的来源 IP/CIDR 格式' });
  }
  try {
    const result = await firewall.addRule({ port, protocol: protocol || 'tcp', comment, from: from || '' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// PUT /api/v1/firewall/rules/:number
async function editRule(req, res) {
  const number = parseInt(req.params.number, 10);
  const { port, protocol, comment, from } = req.body;
  if (isNaN(number)) {
    return res.status(400).json({ error: 'invalid rule number' });
  }
  if (!port) {
    return res.status(400).json({ error: 'port is required' });
  }
  if (from && !isValidIpOrCidr(from)) {
    return res.status(400).json({ error: '无效的来源 IP/CIDR 格式' });
  }
  try {
    const result = await firewall.editRule(number, { port, protocol: protocol || 'tcp', comment, from: from || '' });
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
