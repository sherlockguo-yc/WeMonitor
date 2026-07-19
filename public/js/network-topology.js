/* ===================================================
   WeMonitor — 网络拓扑图
   =================================================== */

// ── 静态拓扑定义 ──

const TOPOLOGY = {
  nodes: [
    { id: 'internet',   label: 'Internet',       icon: 'globe',       x: 60,  y: 40,  w: 110, h: 44, layer: 'external' },
    { id: 'cf-cdn',     label: 'Cloudflare CDN', icon: 'cloud',       x: 60,  y: 110, w: 140, h: 44, layer: 'external' },
    { id: 'cf-tunnel',  label: 'Cloudflare\nTunnel', icon: 'orbit',   x: 60,  y: 190, w: 140, h: 52, layer: 'entry',   dynamic: 'tunnel' },
    { id: 'ufw',        label: 'UFW 防火墙',      icon: 'shield',     x: 260, y: 40,  w: 130, h: 44, layer: 'entry',   dynamic: 'firewall' },
    { id: 'npm',        label: 'NPM',             icon: 'server',     x: 280, y: 170, w: 90,  h: 44, layer: 'proxy' },
    { id: 'wemusic',    label: 'WeMusic',         icon: 'music',      x: 440, y: 110, w: 120, h: 44, layer: 'service', dynamic: 'health', port: 5174, healthIdx: 0 },
    { id: 'wemonitor',  label: 'WeMonitor',       icon: 'activity',   x: 280, y: 250, w: 120, h: 44, layer: 'service', dynamic: 'health', port: 18990, healthIdx: -1 },
    { id: 'wedownload', label: 'WeDownload',      icon: 'download',   x: 440, y: 230, w: 120, h: 44, layer: 'service', dynamic: 'health', port: 8080, healthIdx: 1 },
    { id: 'webhook',    label: 'Webhook',         icon: 'webhook',    x: 280, y: 325, w: 120, h: 44, layer: 'service', port: 9001 },
    { id: 'ssh',        label: 'SSH',             icon: 'terminal',   x: 440, y: 40,  w: 100, h: 44, layer: 'service', dynamic: 'fw-rule', port: 22 },
    { id: 'npm-admin',  label: 'NPM Admin',       icon: 'settings',   x: 580, y: 40,  w: 120, h: 44, layer: 'service', dynamic: 'fw-rule', port: 8443 },
    { id: 'qbittorrent',label: 'qBittorrent',     icon: 'download-cloud', x: 580, y: 110, w: 120, h: 44, layer: 'service', dynamic: 'fw-rule', port: 61553 },
  ],

  edges: [
    { from: 'internet',  to: 'cf-cdn',     style: 'solid',  label: 'HTTPS' },
    { from: 'cf-cdn',    to: 'cf-tunnel',  style: 'solid',  label: 'TLS Tunnel' },
    { from: 'internet',  to: 'ufw',        style: 'solid',  label: '直连 IP' },
    { from: 'cf-tunnel', to: 'npm',        style: 'solid',  label: 'wemusic\nwedownload' },
    { from: 'cf-tunnel', to: 'wemonitor',  style: 'dashed', label: 'wemonitor' },
    { from: 'cf-tunnel', to: 'webhook',    style: 'dashed', label: '/deploy' },
    { from: 'npm',       to: 'wemusic',    style: 'solid',  label: ':5174' },
    { from: 'npm',       to: 'wedownload', style: 'solid',  label: ':8080' },
    { from: 'npm',       to: 'npm-admin',  style: 'dotted', label: '管理面板' },
    { from: 'ufw',       to: 'ssh',        style: 'solid',  label: ':22' },
    { from: 'ufw',       to: 'qbittorrent',style: 'solid',  label: ':61553 TCP/UDP' },
  ],
};

// ── 动态状态 ──

let ntState = { firewall: null, tunnel: null, health: [] };

async function loadNetworkTopology() {
  const container = document.getElementById('nt-diagram');
  container.innerHTML = '<div class="nt-loading">加载网络拓扑...</div>';

  // 并行获取所有状态
  const results = await Promise.allSettled([
    api('/firewall/status'),
    api('/tunnel/status'),
    api('/health'),
  ]);

  ntState.firewall = results[0].status === 'fulfilled' ? results[0].value : null;
  ntState.tunnel   = results[1].status === 'fulfilled' ? results[1].value : null;
  ntState.health   = results[2].status === 'fulfilled' ? results[2].value : [];

  // 更新状态徽章
  updateStatusBadge();

  // 渲染 SVG
  renderTopology(container);
}

function updateStatusBadge() {
  const badge = document.getElementById('nt-status-badge');
  if (!ntState.firewall && !ntState.tunnel) {
    badge.className = 'status-badge status-unhealthy';
    badge.textContent = '数据获取失败';
    return;
  }
  const fwOk = ntState.firewall && ntState.firewall.status === 'active';
  const tunOk = ntState.tunnel && ntState.tunnel.active;
  if (fwOk && tunOk) {
    badge.className = 'status-badge status-healthy';
    badge.textContent = '正常';
  } else {
    badge.className = 'status-badge status-warning';
    badge.textContent = '部分异常';
  }
}

// ── 渲染 SVG ──

function renderTopology(container) {
  const W = 760;
  const H = 400;

  let svg = `<svg class="nt-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  // 定义箭头 marker
  svg += `<defs>
    <marker id="arrow-green" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--success)"/>
    </marker>
    <marker id="arrow-dim" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--text-dim)"/>
    </marker>
    <marker id="arrow-danger" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--danger)"/>
    </marker>
  </defs>`;

  // 渲染连线
  for (const edge of TOPOLOGY.edges) {
    const from = TOPOLOGY.nodes.find(n => n.id === edge.from);
    const to = TOPOLOGY.nodes.find(n => n.id === edge.to);
    if (!from || !to) continue;

    const fx = from.x + from.w / 2;
    const fy = from.y + from.h / 2;
    const tx = to.x + to.w / 2;
    const ty = to.y + to.h / 2;

    // 计算连线端点（从节点边缘出发）
    const { sx, sy, ex, ey } = computeEdgeEndpoints(from, to);

    let color = 'var(--text-dim)';
    let dash = '';
    let marker = 'url(#arrow-dim)';

    if (edge.style === 'dashed') dash = 'stroke-dasharray="6,4"';
    if (edge.style === 'dotted') dash = 'stroke-dasharray="3,3"';

    // 根据源节点状态调整颜色
    if (edge.label === 'TLS Tunnel' && ntState.tunnel && ntState.tunnel.active) {
      color = 'var(--success)';
      marker = 'url(#arrow-green)';
    }
    if (edge.from === 'ufw' && ntState.firewall && ntState.firewall.status !== 'active') {
      color = 'var(--danger)';
      marker = 'url(#arrow-danger)';
    }

    svg += `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="2" ${dash} marker-end="${marker}"/>`;

    // 标签
    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2 - 6;
    const lines = edge.label.split('\n');
    lines.forEach((l, i) => {
      svg += `<text x="${mx}" y="${my + i * 12}" text-anchor="middle" class="nt-edge-label">${l}</text>`;
    });
  }

  // 渲染节点
  for (const node of TOPOLOGY.nodes) {
    const status = getNodeStatus(node);
    const borderColor = status === 'ok' ? 'var(--success)' :
                        status === 'error' ? 'var(--danger)' :
                        status === 'warn' ? 'var(--warning)' : 'var(--border)';
    const bgColor = status === 'error' ? 'var(--danger-bg)' :
                    status === 'warn' ? 'var(--warning-bg)' : 'var(--bg-card)';

    const rx = node.w > 100 ? 'var(--radius)' : 'var(--radius)';

    // 背景
    svg += `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${rx}" fill="${bgColor}" stroke="${borderColor}" stroke-width="2" class="nt-node" data-node="${node.id}"/>`;

    // 图标（用简单的几何表示）
    const iconX = node.x + 12;
    const iconY = node.y + node.h / 2;

    // 状态圆点
    const dotX = node.x + node.w - 14;
    const dotY = node.y + node.h / 2;
    const dotColor = status === 'ok' ? 'var(--success)' :
                     status === 'error' ? 'var(--danger)' :
                     status === 'warn' ? 'var(--warning)' : 'var(--text-dim)';
    
    if (node.dynamic) {
      svg += `<circle cx="${dotX}" cy="${dotY}" r="5" fill="${dotColor}"/>`;
    }

    // 标签
    const labelLines = node.label.split('\n');
    const textX = node.x + 30;
    const textY = node.y + node.h / 2 - (labelLines.length - 1) * 7;
    labelLines.forEach((l, i) => {
      svg += `<text x="${textX}" y="${textY + i * 14}" class="nt-node-label">${l}</text>`;
    });

    // 端口号（如果有）
    if (node.port) {
      svg += `<text x="${node.x + node.w - 24}" y="${node.y + 12}" text-anchor="end" class="nt-port-label">:${node.port}</text>`;
    }
  }

  svg += `</svg>`;

  // Tooltip
  svg += `<div id="nt-tooltip" class="nt-tooltip" style="display:none;"></div>`;

  container.innerHTML = svg;

  // 绑定 hover 事件
  container.querySelectorAll('.nt-node').forEach(rect => {
    rect.addEventListener('mouseenter', showTooltip);
    rect.addEventListener('mouseleave', hideTooltip);
  });
}

function getNodeStatus(node) {
  if (!node.dynamic) return 'static';

  if (node.dynamic === 'tunnel') {
    if (!ntState.tunnel) return 'unknown';
    return ntState.tunnel.active ? 'ok' : 'error';
  }

  if (node.dynamic === 'firewall') {
    if (!ntState.firewall) return 'unknown';
    return ntState.firewall.status === 'active' ? 'ok' : 'error';
  }

  if (node.dynamic === 'fw-rule') {
    // 检查防火墙中该端口是否有 ALLOW 规则
    if (!ntState.firewall || !ntState.firewall.rules) return 'unknown';
    const rules = ntState.firewall.rules;
    const hasAllow = rules.some(r => r.port == node.port && r.action === 'ALLOW');
    // 防火墙未启用但规则存在 → warn；防火墙启用且规则存在 → ok；无规则 → error
    if (!hasAllow) return 'error';
    if (ntState.firewall.status !== 'active') return 'warn';
    return 'ok';
  }

  if (node.dynamic === 'health') {
    if (!Array.isArray(ntState.health) || ntState.health.length === 0) return 'unknown';

    // WeMonitor 自身的健康状态不在 health 列表中（它监控别人），默认视为 ok
    if (node.healthIdx === -1) return 'ok';

    // 按服务名匹配（WeMonitor 监控的是 WeMusic、WeDownload）
    const nameMap = { 0: 'WeMusic', 1: 'WeDownload' };
    const serviceName = nameMap[node.healthIdx];
    const svc = ntState.health.find(h => h.name === serviceName);
    if (!svc) return 'unknown';
    return svc.status === 'healthy' ? 'ok' : 'error';
  }

  return 'static';
}

// ── 连线端点计算 ──

function computeEdgeEndpoints(from, to) {
  const fcx = from.x + from.w / 2;
  const fcy = from.y + from.h / 2;
  const tcx = to.x + to.w / 2;
  const tcy = to.y + to.h / 2;

  const dx = tcx - fcx;
  const dy = tcy - fcy;

  let sx, sy, ex, ey;

  // 从 from 节点的哪条边出发
  if (Math.abs(dx) > Math.abs(dy)) {
    // 水平方向为主
    if (dx > 0) {
      sx = from.x + from.w;
      ex = to.x;
    } else {
      sx = from.x;
      ex = to.x + to.w;
    }
    const ratio = dy / Math.abs(dx || 1);
    sy = fcy + (sx - fcx) * (dy / Math.abs(dx || 1));
    ey = tcy + (ex - tcx) * (dy / Math.abs(dx || 1));
    // clamp
    sy = Math.max(from.y + 4, Math.min(from.y + from.h - 4, sy));
    ey = Math.max(to.y + 4, Math.min(to.y + to.h - 4, ey));
  } else {
    // 垂直方向为主
    if (dy > 0) {
      sy = from.y + from.h;
      ey = to.y;
    } else {
      sy = from.y;
      ey = to.y + to.h;
    }
    const ratio = dx / Math.abs(dy || 1);
    sx = fcx + (sy - fcy) * (dx / Math.abs(dy || 1));
    ex = tcx + (ey - tcy) * (dx / Math.abs(dy || 1));
    // clamp
    sx = Math.max(from.x + 4, Math.min(from.x + from.w - 4, sx));
    ex = Math.max(to.x + 4, Math.min(to.x + to.w - 4, ex));
  }

  return { sx, sy, ex, ey };
}

// ── Tooltip ──

function showTooltip(e) {
  const nodeId = e.target.getAttribute('data-node');
  const node = TOPOLOGY.nodes.find(n => n.id === nodeId);
  if (!node) return;

  const status = getNodeStatus(node);
  const statusText = status === 'ok' ? '正常' :
                     status === 'error' ? '异常' :
                     status === 'warn' ? '警告' :
                     status === 'unknown' ? '未知' : '静态';

  const portText = node.port ? `端口: ${node.port}` : '';
  const protoText = node.id === 'qbittorrent' ? '协议: TCP + UDP' : '';

  const tooltip = document.getElementById('nt-tooltip');
  tooltip.innerHTML = `
    <div class="nt-tt-name">${node.label.replace('\n', ' ')}</div>
    <div class="nt-tt-info">状态: ${statusText}</div>
    ${portText ? `<div class="nt-tt-info">${portText}</div>` : ''}
    ${protoText ? `<div class="nt-tt-info">${protoText}</div>` : ''}
  `;
  tooltip.style.display = 'block';

  const container = document.getElementById('nt-diagram');
  const rect = container.getBoundingClientRect();
  tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
  tooltip.style.top = (e.clientY - rect.top - 40) + 'px';
}

function hideTooltip() {
  document.getElementById('nt-tooltip').style.display = 'none';
}

function refreshPage() {
  loadNetworkTopology();
}

loadNetworkTopology();
