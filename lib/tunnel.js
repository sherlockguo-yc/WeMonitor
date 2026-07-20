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

// 添加子域名路由（DNS + Cloudflare ingress 双写）
async function addRoute(hostname, service) {
  if (!hostname || typeof hostname !== 'string') {
    return { success: false, error: 'hostname is required' };
  }
  if (!service || typeof service !== 'string') {
    return { success: false, error: 'service is required' };
  }
  if (!hostname.endsWith('.sherlockguo.com') && hostname !== 'sherlockguo.com') {
    return { success: false, error: 'hostname must be a subdomain of sherlockguo.com' };
  }

  // Step 1: 创建 DNS CNAME 记录
  const dnsResult = await run('cloudflared', ['tunnel', 'route', 'dns', config.tunnelName, hostname]);
  if (dnsResult.code !== 0 || !dnsResult.stdout.includes('Added')) {
    return {
      success: false,
      hostname,
      error: 'DNS 记录创建失败',
      stdout: dnsResult.stdout,
      stderr: dnsResult.stderr
    };
  }

  // Step 2: 更新 Cloudflare Dashboard 中的 ingress 配置
  const { tunnelId, accountId } = getTunnelIdentifiers();
  if (!tunnelId || !accountId) {
    return {
      success: false, hostname,
      error: 'DNS 记录已创建，但无法获取 Tunnel 标识，ingress 配置未更新。请在 Cloudflare Dashboard 中手动添加 ingress 规则。',
      dnsOk: true
    };
  }

  const currentConfig = await getRemoteConfig(accountId, tunnelId);
  if (!currentConfig) {
    return {
      success: false, hostname,
      error: 'DNS 记录已创建，但无法获取当前 ingress 配置（请检查 CF_API_TOKEN）。请在 Cloudflare Dashboard 中手动添加 ingress 规则。',
      dnsOk: true
    };
  }

  // 构造新规则，插入到 404 catch-all 之前
  const newRule = { hostname, service };
  const ingress = [...currentConfig.ingress];
  const catchAllIdx = ingress.findIndex(r => !r.hostname && r.service === 'http_status:404');
  if (catchAllIdx >= 0) {
    ingress.splice(catchAllIdx, 0, newRule);
  } else {
    ingress.push(newRule);
  }

  // PUT 回 Cloudflare
  const token = process.env.CF_API_TOKEN || '';
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`;
  try {
    const putBody = { config: { ...currentConfig, ingress } };
    const resp = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(putBody),
      signal: AbortSignal.timeout(10000)
    });
    const putResult = await resp.json();

    if (!putResult.success) {
      const cfErrors = (putResult.errors || []).map(e => e.message).join('; ');
      return {
        success: false, hostname,
        error: `DNS 记录已创建，但 ingress 配置更新失败: ${cfErrors || '未知错误'}`,
        dnsOk: true
      };
    }

    return { success: true, hostname, service };
  } catch (err) {
    return {
      success: false, hostname,
      error: `DNS 记录已创建，但 Cloudflare API 调用失败: ${err.message}`,
      dnsOk: true
    };
  }
}

// 从 config.yml 中提取 tunnel ID + account ID（用于 API 调用）
function getTunnelIdentifiers() {
  const CONFIG_PATH = '/etc/cloudflared/config.yml';
  try {
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const tunnelMatch = content.match(/^tunnel:\s+(\S+)/m);
    const tunnelId = tunnelMatch ? tunnelMatch[1] : null;

    const credMatch = content.match(/credentials-file:\s*(.+)/);
    if (credMatch) {
      const credContent = fs.readFileSync(credMatch[1].trim(), 'utf-8');
      const credJson = JSON.parse(credContent);
      return { tunnelId, accountId: credJson.AccountTag || null, configPath: CONFIG_PATH };
    }
    return { tunnelId, accountId: null, configPath: CONFIG_PATH };
  } catch {
    return { tunnelId: null, accountId: null, configPath: CONFIG_PATH };
  }
}

// 从 Cloudflare API 获取完整 Tunnel 配置（用于读取和写入）
async function getRemoteConfig(accountId, tunnelId) {
  const token = process.env.CF_API_TOKEN || '';
  if (!token || !accountId || !tunnelId) return null;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`;
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json.success || !json.result?.config?.ingress) return null;
    return json.result.config;
  } catch {
    return null;
  }
}

// 从 Cloudflare API 获取远程 ingress 配置（Dashboard 管理模式的真实源）
async function fetchRemoteIngress(accountId, tunnelId) {
  const configData = await getRemoteConfig(accountId, tunnelId);
  if (!configData) return null;

  const routes = [];
  for (const rule of configData.ingress) {
    if (rule.service && rule.service !== 'http_status:404' && rule.hostname) {
      routes.push({
        hostname: rule.hostname,
        service: rule.service,
        path: rule.path || null,
        type: 'http'
      });
    }
  }
  return routes;
}

// ============================================================
// 获取 Tunnel 路由
//
// 数据源：Cloudflare Dashboard（单一数据源，避免本地配置不一致）
//         → GET /client/v4/accounts/:id/cfd_tunnel/:id/configurations
//
// 约束：禁止从 /etc/cloudflared/config.yml 读取 ingress 段。
//      该文件仅用于 cloudflared 进程的连接凭证，路由规则由
//      Cloudflare Dashboard 统一管理，WeMonitor 通过 API 同步。
//
// 依赖：N150 ~/wemonitor/.env 中需配置 export CF_API_TOKEN=...
//       权限范围：Cloudflare Tunnel — Edit（读取路由 + 添加路由都需要）
// ============================================================
async function getRoutes() {
  const { tunnelId, accountId, configPath } = getTunnelIdentifiers();

  if (!tunnelId || !accountId) {
    return { success: false, error: '无法获取 Tunnel 标识（请检查 config.yml）', routes: [] };
  }

  const routes = await fetchRemoteIngress(accountId, tunnelId);
  if (!routes) {
    return {
      success: false,
      error: 'Cloudflare API 不可用。请确认 CF_API_TOKEN 已配置且 N150 能访问 api.cloudflare.com',
      routes: []
    };
  }

  return { success: true, routes, source: 'cloudflare-api', tunnelId };
}

module.exports = { getStatus, restart, getLogs, addRoute, getRoutes };
