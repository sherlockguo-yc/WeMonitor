const { execFile } = require('child_process');
const http = require('http');

// stok 缓存（token 有有效期，缓存 5 分钟）
let stokCache = { token: null, expires: 0 };

async function getStok() {
  const now = Date.now();
  if (stokCache.token && stokCache.expires > now) return stokCache.token;

  return new Promise((resolve) => {
    const url = 'http://192.168.31.1/cgi-bin/luci/api/xqsystem/login?username=admin&password=17279787120';
    http.get(url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.code === 0 && data.token) {
            stokCache = { token: data.token, expires: now + 5 * 60 * 1000 };
            resolve(data.token);
          } else {
            resolve(null);
          }
        } catch (_) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function routerApi(path) {
  const stok = await getStok();
  if (!stok) return null;
  return new Promise((resolve) => {
    const url = `http://192.168.31.1/cgi-bin/luci/;stok=${stok}${path}`;
    http.get(url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (_) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function ping(host) {
  return new Promise((resolve) => {
    execFile('ping', ['-c', '2', '-W', '1', host], { timeout: 4000 }, (err, stdout) => {
      if (err) return resolve({ online: false, latency: null });
      const match = stdout.match(/min\/avg\/max\/mdev = [\d.]+\/([\d.]+)\//);
      const latency = match ? parseFloat(match[1]) : null;
      resolve({ online: true, latency });
    });
  });
}

async function getModem() {
  const { online, latency } = await ping('192.168.1.1');
  return {
    ip: '192.168.1.1',
    online,
    latency,
    name: '光猫',
    type: 'CMCC ONT',
    ports: { lan: 4, pots: 1, usb: 1, wifi: 0 },
  };
}

async function getRouter() {
  const [pingResult, status, deviceInfo] = await Promise.all([
    ping('192.168.31.1'),
    routerApi('/api/misystem/status'),
    routerApi('/api/xqsystem/init_info'),
  ]);

  const result = {
    ip: '192.168.31.1',
    online: pingResult.online,
    latency: pingResult.latency,
    name: '路由器',
    model: '未知',
    firmware: '未知',
    uptime: null,
    cpu: null,
    mem: null,
    wan: null,
    devices: [],
  };

  if (status && status.code === 0) {
    if (status.hardware) result.model = status.hardware.displayName || '小米路由器';
    if (status.upTime) result.uptime = parseFloat(status.upTime);
    if (status.cpu) result.cpu = { load: status.cpu.load, core: status.cpu.core };
    if (status.mem) result.mem = { usage: status.mem.usage, total: status.mem.total };
    if (status.wan) result.wan = { down: status.wan.downspeed, up: status.wan.upspeed };
  }

  if (deviceInfo && deviceInfo.code === 0) {
    if (deviceInfo.romversion) result.firmware = deviceInfo.romversion;
    if (deviceInfo.routername) result.hostname = deviceInfo.routername;
  }

  // 在线设备列表
  if (status && status.dev && Array.isArray(status.dev)) {
    result.devices = status.dev
      .filter(d => d.devname && d.devname !== 'Others')
      .map(d => ({
        name: d.devname,
        mac: d.mac,
        online: parseInt(d.online) > 0,
        downSpeed: parseInt(d.downspeed) || 0,
        upSpeed: parseInt(d.upspeed) || 0,
      }));
  }

  return result;
}

// N150 自身状态
async function getN150() {
  try {
    const si = require('systeminformation');
    const [cpuLoad, mem] = await Promise.all([
      si.currentLoad(),
      si.mem(),
    ]);
    return {
      ip: '192.168.31.102',
      online: true,
      name: 'N150 服务器',
      cpu: { usage: cpuLoad.currentLoad, core: cpuLoad.cpus.length },
      mem: { usage: (mem.used / mem.total) * 100, total: (mem.total / 1024 / 1024 / 1024).toFixed(1) + 'GB' },
      uptime: process.uptime(),
    };
  } catch (_) {
    return {
      ip: '192.168.31.102',
      online: true,
      name: 'N150 服务器',
      cpu: null, mem: null, uptime: null,
    };
  }
}

async function getStatus(req, res) {
  try {
    const [modem, router, n150] = await Promise.all([
      getModem(),
      getRouter(),
      getN150(),
    ]);
    res.json({ modem, router, n150 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getStatus };
