/* ===================================================
   WeMonitor — 网络拓扑图
   =================================================== */

// ── 静态拓扑定义 ──

// Canvas: W=1100, H=510
// 4 层结构（自上而下）：外部 → 入口 → 隧道/代理 → 服务
// 服务分散在底部一排，避免任何线条穿过其它节点

const TOPOLOGY = {
  nodes: [
    // Layer 1: Internet（顶部居中）
    { id: 'internet',   label: 'Internet',          x: 470, y: 30,  w: 120, h: 44 },

    // Layer 2: 入口层
    { id: 'cf-cdn',     label: 'Cloudflare CDN',    x: 100, y: 130, w: 170, h: 44 },
    { id: 'ufw',        label: 'UFW 防火墙',         x: 470, y: 130, w: 140, h: 44, dynamic: 'firewall' },

    // Layer 3: 隧道
    { id: 'cf-tunnel',  label: 'Cloudflare\nTunnel',x: 100, y: 240, w: 170, h: 52, dynamic: 'tunnel' },

    // Layer 4: 服务（底部一排，从左到右按访问路径分组）
    // Cloudflare → Tunnel → WeMonitor / Webhook
    { id: 'wemonitor',  label: 'WeMonitor',         x: 100, y: 420, w: 130, h: 44, dynamic: 'health', port: 18990, healthIdx: -1 },
    { id: 'webhook',    label: 'Webhook',           x: 250, y: 420, w: 110, h: 44, port: 9001 },
    // Cloudflare → Tunnel → WeMusic / WeDownload
    { id: 'wemusic',    label: 'WeMusic',           x: 360, y: 420, w: 120, h: 44, dynamic: 'health', port: 5174, healthIdx: 0 },
    { id: 'wedownload', label: 'WeDownload',        x: 500, y: 420, w: 140, h: 44, dynamic: 'health', port: 8080, healthIdx: 1 },
    // UFW → SSH / qBittorrent / NPM Admin（直连服务）
    { id: 'ssh',        label: 'SSH',               x: 670, y: 420, w: 100, h: 44, dynamic: 'fw-rule', port: 22 },
    { id: 'qbittorrent',label: 'qBittorrent',       x: 790, y: 420, w: 140, h: 44, dynamic: 'fw-rule', port: 61553 },
    { id: 'npm-admin',  label: 'NPM Admin',         x: 950, y: 420, w: 120, h: 44, dynamic: 'fw-rule', port: 8443 },
  ],

  edges: [
    { from: 'internet',  to: 'cf-cdn',     style: 'solid',  label: 'HTTPS' },
    { from: 'internet',  to: 'ufw',        style: 'solid',  label: '直连' },
    { from: 'cf-cdn',    to: 'cf-tunnel',  style: 'solid',  label: 'TLS' },
    { from: 'ufw',       to: 'ssh',        style: 'solid',  label: ':22' },
    { from: 'ufw',       to: 'qbittorrent',style: 'solid',  label: ':61553' },
    { from: 'ufw',       to: 'npm-admin',  style: 'solid',  label: ':8443' },
    { from: 'cf-tunnel', to: 'wemonitor',  style: 'dashed', label: '' },
    { from: 'cf-tunnel', to: 'webhook',    style: 'dashed', label: '/deploy' },
    { from: 'cf-tunnel', to: 'wemusic',    style: 'solid',  label: '' },
    { from: 'cf-tunnel', to: 'wedownload', style: 'solid',  label: '' },
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
  const W = 1100;
  const H = 510;

  // 层级标签位置
  const layers = [
    { y: 30,  h: 44, label: '外部' },
    { y: 130, h: 44, label: '入口' },
    { y: 240, h: 52, label: '隧道' },
    { y: 420, h: 44, label: '服务' },
  ];

  let svg = `<svg class="nt-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  // 层级分隔线
  [102, 207, 356].forEach(y => {
    svg += `<line x1="40" y1="${y}" x2="${W - 10}" y2="${y}" stroke="var(--border-light)" stroke-width="1" stroke-dasharray="2,4"/>`;
  });

  // 层级标签（左侧）
  layers.forEach(layer => {
    svg += `<text x="12" y="${layer.y + layer.h / 2 + 4}" class="nt-layer-label">${layer.label}</text>`;
  });

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

    // 计算连线端点（从节点边缘出发）
    const { sx, sy, ex, ey } = computeEdgeEndpoints(from, to);

    let color = 'var(--text-dim)';
    let dash = '';
    let marker = 'url(#arrow-dim)';

    if (edge.style === 'dashed') dash = 'stroke-dasharray="6,4"';
    if (edge.style === 'dotted') dash = 'stroke-dasharray="3,3"';

    // 根据源节点状态调整颜色
    if (edge.from === 'cf-tunnel' && ntState.tunnel && ntState.tunnel.active) {
      color = 'var(--success)';
      marker = 'url(#arrow-green)';
    }
    if (edge.from === 'ufw' && ntState.firewall && ntState.firewall.status !== 'active') {
      color = 'var(--danger)';
      marker = 'url(#arrow-danger)';
    }

    // 箭头收尾缩短几像素，避免 marker 被节点边框挡住
    const angle = Math.atan2(ey - sy, ex - sx);
    const shortenEnd = 4;
    const ex2 = ex - shortenEnd * Math.cos(angle);
    const ey2 = ey - shortenEnd * Math.sin(angle);

    svg += `<line x1="${sx}" y1="${sy}" x2="${ex2}" y2="${ey2}" stroke="${color}" stroke-width="2" ${dash} marker-end="${marker}"/>`;

    // 标签：放在中点偏移位置（沿垂直于连线的方向偏移）
    if (edge.label) {
      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2;
      // 垂直方向偏移：根据连线走向决定上下还是左右
      const isHorizontal = Math.abs(ex - sx) > Math.abs(ey - sy);
      const labelOffsetX = isHorizontal ? 0 : -8;
      const labelOffsetY = isHorizontal ? -8 : 0;
      const lines = edge.label.split('\n');
      const textWidth = Math.max(...lines.map(l => l.length)) * 6; // 估算宽度
      // 给标签加白底，避免压线（用 bg-card 与卡片背景一致）
      const labelH = lines.length * 12 + 4;
      const labelW = textWidth + 10;
      const labelX = mx + labelOffsetX - labelW / 2;
      const labelY = my + labelOffsetY - lines.length * 6;
      svg += `<rect x="${labelX}" y="${labelY - labelH / 2}" width="${labelW}" height="${labelH}" fill="var(--bg-card)" rx="3"/>`;
      lines.forEach((l, i) => {
        svg += `<text x="${mx + labelOffsetX}" y="${my + labelOffsetY + (i - (lines.length - 1) / 2) * 12}" text-anchor="middle" class="nt-edge-label">${l}</text>`;
      });
    }
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
  loadPhysicalTopology();
}

loadNetworkTopology();
loadPhysicalTopology();

// ── 物理拓扑 ──

let ptState = { modem: null, router: null, n150: null };

async function loadPhysicalTopology() {
  const container = document.getElementById('pt-diagram');
  if (!container) return;
  container.innerHTML = '<div class="nt-loading">加载物理拓扑...</div>';

  try {
    const data = await api('/physical-topology');
    if (!data) {
      // api() 返回 null 表示请求失败（401/500 等）
      ptState = { error: true };
    } else {
      ptState = data;
    }
  } catch (_) {
    ptState = { error: true };
  }

  updatePtBadge();
  renderPhysicalTopology(container);
}

function updatePtBadge() {
  const badge = document.getElementById('pt-status-badge');
  if (!badge) return;
  if (ptState.error || !ptState.modem) {
    badge.className = 'status-badge status-unhealthy';
    badge.textContent = '数据获取失败';
    return;
  }
  const allOnline = ptState.modem.online && ptState.router.online && ptState.n150.online;
  badge.className = allOnline ? 'status-badge status-healthy' : 'status-badge status-warning';
  badge.textContent = allOnline ? '全部在线' : '部分离线';
}

function renderPhysicalTopology(container) {
  const W = 1000;
  const H = 300;

  // 节点定义（垂直栈：Internet → 光猫 → 路由器 → N150）
  const nodes = [
    { id: 'internet', label: 'Internet',    x: 350, y: 20,  w: 120, h: 36 },
    { id: 'modem',     label: '光猫',        x: 350, y: 90,  w: 120, h: 36 },
    { id: 'router',    label: '路由器',      x: 350, y: 165, w: 120, h: 36 },
    { id: 'n150',      label: 'N150 服务器', x: 340, y: 240, w: 140, h: 36 },
  ];

  let svg = `<svg class="nt-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<defs>
    <marker id="pt-arrow-green" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--success)"/>
    </marker>
    <marker id="pt-arrow-dim" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--text-dim)"/>
    </marker>
    <marker id="pt-arrow-danger" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--danger)"/>
    </marker>
  </defs>`;

  // 连线：Internet → 光猫 → 路由器 → N150
  const edges = [
    { from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 },
  ];

  for (const e of edges) {
    const from = nodes[e.from];
    const to = nodes[e.to];
    const sx = from.x + from.w / 2;
    const sy = from.y + from.h;
    const ex = to.x + to.w / 2;
    const ey = to.y;

    let color = 'var(--text-dim)', marker = 'url(#pt-arrow-dim)';
    const online = nodeOnline(to.id);
    if (online === true)      { color = 'var(--success)'; marker = 'url(#pt-arrow-green)'; }
    else if (online === false) { color = 'var(--danger)';  marker = 'url(#pt-arrow-danger)'; }

    svg += `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey - 4}" stroke="${color}" stroke-width="2" marker-end="${marker}"/>`;
  }

  // 节点
  for (const node of nodes) {
    const online = nodeOnline(node.id);
    const borderColor = online === null ? 'var(--border)' :
                        online ? 'var(--success)' : 'var(--danger)';
    const bgColor = online === false ? 'var(--danger-bg)' : 'var(--bg-card)';

    svg += `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="6" fill="${bgColor}" stroke="${borderColor}" stroke-width="2"/>`;

    // 状态圆点
    if (online !== null) {
      const dotColor = online ? 'var(--success)' : 'var(--danger)';
      svg += `<circle cx="${node.x + node.w - 14}" cy="${node.y + node.h / 2}" r="5" fill="${dotColor}"/>`;
    }

    svg += `<text x="${node.x + node.w / 2}" y="${node.y + node.h / 2 + 4}" text-anchor="middle" class="nt-node-label">${node.label}</text>`;
  }

  // 右侧详情面板
  const dx = 510; // 详情起始 X

  // 光猫详情
  if (ptState.modem) {
    const m = ptState.modem;
    const y = 90;
    svg += ptDetailLine(dx, y, 'CMCC ONT', true);
    svg += ptDetailLine(dx, y + 15, `IP: ${m.ip}  ·  延迟: ${m.latency !== null ? m.latency.toFixed(1) + 'ms' : '-'}`);
    svg += ptDetailLine(dx, y + 28, `LAN ×${m.ports.lan}  ·  POTS ×${m.ports.pots}  ·  USB ×${m.ports.usb}`);
  }

  // 路由器详情
  if (ptState.router) {
    const r = ptState.router;
    const y = 165;
    svg += ptDetailLine(dx, y, r.model || '小米路由器', true);
    const lines = [];
    lines.push(`固件: ${r.firmware || '-'}  ·  IP: ${r.ip}`);
    if (r.uptime !== null) lines.push(`运行: ${formatUptime(r.uptime)}`);
    if (r.cpu) lines.push(`CPU: ${r.cpu.load}% (${r.cpu.core}核)  ·  内存: ${r.mem ? (r.mem.usage * 100).toFixed(0) + '% / ' + r.mem.total : '-'}`);
    if (r.wan) lines.push(`WAN: ↓${formatSpeed(r.wan.down)}  ↑${formatSpeed(r.wan.up)}`);
    lines.forEach((l, i) => { svg += ptDetailLine(dx, y + 15 + i * 15, l); });
  }

  // N150 详情
  if (ptState.n150) {
    const n = ptState.n150;
    const y = 240;
    svg += ptDetailLine(dx, y, 'N150 服务器', true);
    const lines = [];
    lines.push(`IP: ${n.ip}`);
    if (n.uptime !== null) lines.push(`运行: ${formatUptime(n.uptime)}`);
    if (n.cpu) lines.push(`CPU: ${n.cpu.usage.toFixed(0)}% (${n.cpu.core}核)  ·  内存: ${n.mem ? n.mem.usage.toFixed(0) + '% / ' + n.mem.total : '-'}`);
    lines.forEach((l, i) => { svg += ptDetailLine(dx, y + 15 + i * 15, l); });
  }

  svg += `</svg>`;
  container.innerHTML = svg;
}

function ptDetailLine(x, y, text, isTitle) {
  const cls = isTitle ? 'nt-detail-title' : 'nt-detail-text';
  return `<text x="${x}" y="${y}" class="${cls}">${escHtml(text)}</text>`;
}

function nodeOnline(id) {
  if (id === 'internet') return null;
  if (id === 'modem') return ptState.modem ? ptState.modem.online : null;
  if (id === 'router') return ptState.router ? ptState.router.online : null;
  if (id === 'n150') return ptState.n150 ? ptState.n150.online : null;
  return null;
}

function formatUptime(seconds) {
  if (typeof seconds !== 'number') return '-';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天 ${h}小时`;
  if (h > 0) return `${h}小时 ${m}分`;
  return `${m}分`;
}

function formatSpeed(bytesPerSec) {
  const v = parseInt(bytesPerSec) || 0;
  if (v >= 1048576) return (v / 1048576).toFixed(1) + 'MB/s';
  if (v >= 1024) return (v / 1024).toFixed(0) + 'KB/s';
  return v + 'B/s';
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
