const net = require('net');
const { stmts } = require('../db');

function tcpProbe(host, port, timeout = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    socket.setTimeout(timeout);

    socket.on('connect', () => {
      const latency = Date.now() - start;
      socket.destroy();
      resolve({ status: 'healthy', latency_ms: latency, message: '' });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ status: 'unhealthy', latency_ms: timeout, message: 'Connection timed out' });
    });

    socket.on('error', (err) => {
      socket.destroy();
      resolve({ status: 'unhealthy', latency_ms: Date.now() - start, message: err.message });
    });

    socket.connect(port, host);
  });
}

async function checkAll() {
  const services = stmts.getAllServices.all();
  const now = Date.now();
  const results = [];

  for (const svc of services) {
    if (!svc.enabled || !svc.health_target) continue;

    let result;
    if (svc.health_type === 'tcp') {
      const [host, portStr] = svc.health_target.split(':');
      const port = parseInt(portStr, 10);
      result = await tcpProbe(host, port);
    } else {
      result = { status: 'unknown', latency_ms: 0, message: `Unsupported health type: ${svc.health_type}` };
    }

    stmts.insertHealthCheck.run(svc.id, result.status, result.latency_ms, result.message, now);
    results.push({ service_id: svc.id, name: svc.name, ...result });
  }

  return results;
}

module.exports = { checkAll, tcpProbe };
