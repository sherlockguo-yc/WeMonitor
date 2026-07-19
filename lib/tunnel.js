const { execFile } = require('child_process');
const fs = require('fs');
const config = require('../config');

function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15000, ...opts }, (err, stdout, stderr) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), error: err ? err.message : null, code: err ? err.code : 0 });
    });
  });
}

// 获取 Tunnel 完整状态
async function getStatus() {
  // 并行获取多个信息源
  const [sysStatus, connections, tunnelInfo] = await Promise.all([
    run('systemctl', ['status', 'cloudflared', '--no-pager']),
    run('sudo', ['journalctl', '-u', 'cloudflared', '--no-pager', '-n', '20']),
    run('cloudflared', ['tunnel', 'info', config.tunnelName], { timeout: 10000 }).catch(() => ({ stdout: '', stderr: '' }))
  ]);

  // 解析 systemctl status
  let active = false, activeSince = null, mainPid = null;
  const lines = sysStatus.stdout.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    const activeMatch = trimmed.match(/^Active:\s+(\w+)\s+\((\w+)\)\s+since\s+(.+);(.+)$/);
    if (activeMatch) {
      active = activeMatch[1] === 'active';
      activeSince = activeMatch[3].trim();
    }
    const pidMatch = trimmed.match(/Main PID:\s+(\d+)/);
    if (pidMatch) mainPid = parseInt(pidMatch[1]);
  }

  // 解析连接信息
  const connLines = connections.stdout.split('\n').filter(l => l.includes('Registered tunnel connection'));
  const connCount = connLines.length;
  const locations = [...new Set(
    connLines.map(l => {
      const m = l.match(/location=(\S+)/);
      return m ? m[1] : null;
    }).filter(Boolean)
  )];

  // 解析 tunnel info
  let tunnelId = null;
  if (tunnelInfo.stdout) {
    const idMatch = tunnelInfo.stdout.match(/id:\s*(\S+)/);
    if (idMatch) tunnelId = idMatch[1];
  }

  return {
    name: config.tunnelName,
    active,
    activeSince,
    mainPid,
    tunnelId: tunnelId || '8d17217c-96d0-4433-ac02-540f8e539f1c',
    connections: connCount,
    locations,
    serviceError: sysStatus.error
  };
}

// 重启 Tunnel
async function restart() {
  const result = await run('sudo', ['systemctl', 'restart', 'cloudflared']);
  return {
    success: result.code === 0,
    error: result.error,
    stderr: result.stderr
  };
}

// 获取日志
async function getLogs(lines = 50) {
  const result = await run('sudo', ['journalctl', '-u', 'cloudflared', '--no-pager', '-n', String(lines)]);
  return {
    lines: result.stdout.split('\n').filter(Boolean),
    error: result.error
  };
}

// 添加子域名路由
async function addRoute(hostname) {
  if (!hostname || typeof hostname !== 'string') {
    return { success: false, error: 'hostname is required' };
  }
  // 安全校验：必须以已知域名为后缀
  if (!hostname.endsWith('.sherlockguo.com') && hostname !== 'sherlockguo.com') {
    return { success: false, error: 'hostname must be a subdomain of sherlockguo.com' };
  }
  const result = await run('cloudflared', ['tunnel', 'route', 'dns', config.tunnelName, hostname]);
  return {
    success: result.code === 0 && result.stdout.includes('Added'),
    hostname,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error
  };
}

// 获取 Tunnel 路由配置（解析 /etc/cloudflared/config.yml ingress 规则）
function getRoutes() {
  try {
    const content = fs.readFileSync('/etc/cloudflared/config.yml', 'utf-8');
    const routes = [];
    const lines = content.split('\n');
    let inIngress = false;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      // 进入 ingress 配置块
      if (trimmed === 'ingress:') {
        inIngress = true;
        continue;
      }
      if (!inIngress) continue;

      // 解析 hostname + service 对
      const hostnameMatch = trimmed.match(/^-\s+hostname:\s+(\S+)/);
      if (hostnameMatch) {
        const hostname = hostnameMatch[1];
        // 同一行或下一行找 service
        const serviceMatch = trimmed.match(/service:\s+(\S+)/);
        let service = null;

        if (serviceMatch) {
          service = serviceMatch[1];
        } else if (i + 1 < lines.length) {
          // service 在下一行
          const nextLine = lines[i + 1].trim();
          const nextServiceMatch = nextLine.match(/service:\s+(\S+)/);
          if (nextServiceMatch) service = nextServiceMatch[1];
        }

        if (service && service !== 'http_status:404') {
          // 检查是否有 path 限制
          const pathMatch = trimmed.match(/path:\s+(\S+)/);
          routes.push({
            hostname,
            service,
            path: pathMatch ? pathMatch[1] : null
          });
        }
        continue;
      }

      // 遇到 catch-all 规则则退出 ingress
      if (trimmed.startsWith('- service:')) {
        // 这是 catch-all，不添加到路由列表
        continue;
      }
    }

    return {
      success: true,
      routes,
      source: '/etc/cloudflared/config.yml'
    };
  } catch (err) {
    return { success: false, error: err.message, routes: [] };
  }
}

module.exports = { getStatus, restart, getLogs, addRoute, getRoutes };
