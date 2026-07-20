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
  // 并行获取：systemctl 状态 + cloudflared tunnel info（代替不可靠的 journalctl -n 20）
  const [sysStatus, tunnelInfo] = await Promise.all([
    run('systemctl', ['status', 'cloudflared', '--no-pager']),
    run('cloudflared', ['tunnel', 'info', config.tunnelName], { timeout: 10000 }).catch(() => ({ stdout: '', stderr: '' }))
  ]);

  // 解析 systemctl status → active 状态 + PID + 启动时间
  let active = false, activeSinceISO = null, mainPid = null;
  const lines = sysStatus.stdout.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    const activeMatch = trimmed.match(/^Active:\s+(\w+)\s+\((\w+)\)\s+since\s+(.+);(.+)$/);
    if (activeMatch) {
      active = activeMatch[1] === 'active';
      // 转换为 ISO 8601 UTC 字符串，避免前端对非标准时区缩写解析不一致
      // systemctl 输出的时区缩写（如 CST）在 Node.js 中会歧义（可能被解析为 Central Standard Time UTC-6）
      // 去掉时区缩写，让 Date 按服务器本地时区（Asia/Shanghai, UTC+8）解析
      const rawSince = activeMatch[3].trim().replace(/ [A-Z]{3,4}$/, '');
      const sinceDate = new Date(rawSince);
      if (!isNaN(sinceDate.getTime())) {
        activeSinceISO = sinceDate.toISOString();
      }
    }
    const pidMatch = trimmed.match(/Main PID:\s+(\d+)/);
    if (pidMatch) mainPid = parseInt(pidMatch[1]);
  }

  // 解析 cloudflared tunnel info → 连接数、边缘节点、Tunnel ID
  let tunnelId = null;
  let connCount = 0;
  let locations = [];
  const infoStdout = tunnelInfo.stdout || '';

  // 解析 tunnel ID
  const idMatch = infoStdout.match(/^ID:\s*(\S+)/m);
  if (idMatch) tunnelId = idMatch[1];

  // 解析连接器表格中的 EDGE 列（如 "2xlax01, 2xlax07"）
  // 格式：CONNECTOR ID ... EDGE\nUUID CREATED ... 2xlax01, 2xlax07
  const edgeMatch = infoStdout.match(/EDGE\s*\n\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)/);
  if (edgeMatch) {
    const edgeStr = edgeMatch[1].trim();
    // "2xlax01, 2xlax07" → [{count: 2, loc: "lax01"}, ...]
    const parts = edgeStr.split(/,\s*/);
    for (const p of parts) {
      const m = p.match(/^(\d+)x(\S+)$/);
      if (m) {
        connCount += parseInt(m[1], 10);
        locations.push(m[2]);
      }
    }
  }

  return {
    name: config.tunnelName || null,
    active,
    activeSinceISO,
    mainPid,
    tunnelId: tunnelId || null,
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
  const CONFIG_PATH = '/etc/cloudflared/config.yml';
  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
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

      // 解析 hostname + service 对（支持 path 在中间的多行格式）
      const hostnameMatch = trimmed.match(/^-\s+hostname:\s+(\S+)/);
      if (hostnameMatch) {
        const hostname = hostnameMatch[1];
        let service = null;
        let path = null;

        // 在当前行找 service 和 path
        const svcMatch = trimmed.match(/service:\s+(\S+)/);
        const pathMatch = trimmed.match(/path:\s+(\S+)/);
        if (svcMatch) service = svcMatch[1];
        if (pathMatch) path = pathMatch[1];

        // 如果 service 没找到，向后扫描最多 2 行（path 可能夹在中间）
        if (!service) {
          for (let j = 1; j <= 2 && i + j < lines.length; j++) {
            const nl = lines[i + j].trim();
            const ns = nl.match(/service:\s+(\S+)/);
            const np = nl.match(/path:\s+(\S+)/);
            if (ns && !service) service = ns[1];
            if (np && !path) path = np[1];
          }
        }

        if (service && service !== 'http_status:404') {
          routes.push({ hostname, service, path });
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
      source: CONFIG_PATH
    };
  } catch (err) {
    return { success: false, error: `无法读取 ${CONFIG_PATH}: ${err.message}`, routes: [] };
  }
}

module.exports = { getStatus, restart, getLogs, addRoute, getRoutes };
