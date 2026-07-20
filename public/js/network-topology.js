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

    // Layer 4: 服务（底部一排，从左到右按访问路径分组，间距统一 20px）
    // Cloudflare → Tunnel → WeMonitor / Webhook
    { id: 'wemonitor',  label: 'WeMonitor',         x: 100, y: 420, w: 130, h: 44, dynamic: 'health', port: 18990, healthIdx: -1 },
    { id: 'webhook',    label: 'Webhook',           x: 250, y: 420, w: 110, h: 44, port: 9001 },
    // Cloudflare → Tunnel → WeMusic / WeDownload
    { id: 'wemusic',    label: 'WeMusic',           x: 380, y: 420, w: 120, h: 44, dynamic: 'health', port: 5174, healthIdx: 0 },
    { id: 'wedownload', label: 'WeDownload',        x: 520, y: 420, w: 140, h: 44, dynamic: 'health', port: 8080, healthIdx: 1 },
    // UFW → SSH（直连服务）
    { id: 'ssh',        label: 'SSH',               x: 680, y: 420, w: 100, h: 44, dynamic: 'fw-rule', port: 22 },
  ],

  edges: [
    { from: 'internet',  to: 'cf-cdn',     style: 'solid',  label: 'HTTPS' },
    { from: 'internet',  to: 'ufw',        style: 'solid',  label: '直连' },
    { from: 'cf-cdn',    to: 'cf-tunnel',  style: 'solid',  label: 'TLS' },
    { from: 'ufw',       to: 'ssh',        style: 'solid',  label: ':22' },
    { from: 'cf-tunnel', to: 'wemonitor',  style: 'dashed', label: '' },
    { from: 'cf-tunnel', to: 'webhook',    style: 'dashed', label: '/deploy' },
    { from: 'cf-tunnel', to: 'wemusic',    style: 'dashed', label: '' },
    { from: 'cf-tunnel', to: 'wedownload', style: 'dashed', label: '' },
  ],
};

// ── 动态状态 ──

let ntState = { firewall: null, tunnel: null, health: [] };

async function loadNetworkTopology() {
  const container = document.getElementById('nt-diagram');
  container.innerHTML = '<div class="nt-loading">加载网络拓扑...</div>';

  // 合并视图：物理拓扑（含光猫/路由器 + 完整网络链路）
  await loadPhysicalTopology();
}

// ── 渲染 SVG ──

function renderTopology(container, opts = {}) {
  const topology = opts.topology || TOPOLOGY;
  const state = opts.state || ntState;
  const W = opts.W || 1100;
  const H = opts.H || 510;
  const layers = opts.layers || [
    { y: 30,  h: 44, label: '外部' },
    { y: 130, h: 44, label: '入口' },
    { y: 240, h: 52, label: '隧道' },
    { y: 420, h: 44, label: '服务' },
  ];
  const separators = opts.separators || [102, 207, 356];
  const tooltipId = opts.tooltipId || 'nt-tooltip';
  const arrowPrefix = opts.arrowPrefix || '';
  const getNodeStatusFn = opts.getNodeStatusFn || getNodeStatus;

  let svg = `<svg class="nt-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  // 层级分隔线
  separators.forEach(y => {
    svg += `<line x1="40" y1="${y}" x2="${W - 10}" y2="${y}" stroke="var(--border-light)" stroke-width="1" stroke-dasharray="2,4"/>`;
  });

  // 层级标签（左侧）
  layers.forEach(layer => {
    svg += `<text x="12" y="${layer.y + layer.h / 2 + 4}" class="nt-layer-label">${layer.label}</text>`;
  });

  // 定义箭头 marker
  svg += `<defs>
    <marker id="${arrowPrefix}arrow-green" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--success)"/>
    </marker>
    <marker id="${arrowPrefix}arrow-dim" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--text-dim)"/>
    </marker>
    <marker id="${arrowPrefix}arrow-danger" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--danger)"/>
    </marker>
  </defs>`;

  // 渲染连线
  for (const edge of topology.edges) {
    const from = topology.nodes.find(n => n.id === edge.from);
    const to = topology.nodes.find(n => n.id === edge.to);
    if (!from || !to) continue;

    // 计算连线端点（从节点边缘出发）
    const { sx, sy, ex, ey } = computeEdgeEndpoints(from, to);

    let color = 'var(--text-dim)';
    let dash = '';
    let marker = `url(#${arrowPrefix}arrow-dim)`;

    if (edge.style === 'dashed') dash = 'stroke-dasharray="6,4"';
    if (edge.style === 'dotted') dash = 'stroke-dasharray="3,3"';

    const ap = arrowPrefix;
    // 根据源节点状态调整颜色
    if (edge.from === 'cf-tunnel' && state.tunnel && state.tunnel.active) {
      color = 'var(--success)';
      marker = `url(#${ap}arrow-green)`;
    }
    if (edge.from === 'ufw' && state.firewall && state.firewall.status !== 'active') {
      color = 'var(--danger)';
      marker = `url(#${ap}arrow-danger)`;
    }
    if (edge.from === 'router' && ptState.router && ptState.router.online) {
      color = 'var(--success)';
      marker = `url(#${ap}arrow-green)`;
    }
    if (edge.from === 'modem' && ptState.modem && ptState.modem.online) {
      color = 'var(--success)';
      marker = `url(#${ap}arrow-green)`;
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
  for (const node of topology.nodes) {
    const status = getNodeStatusFn(node);
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
  svg += `<div id="${tooltipId}" class="nt-tooltip" style="display:none;"></div>`;

  container.innerHTML = svg;

  // 绑定 hover 事件
  container.querySelectorAll('.nt-node').forEach(rect => {
    rect.addEventListener('mouseenter', (e) => showTooltip(e, topology, getNodeStatusFn, tooltipId));
    rect.addEventListener('mouseleave', () => hideTooltip(tooltipId));
  });

  // 状态圆点阻止鼠标事件穿透（避免覆盖节点 rect 的 hover）
  container.querySelectorAll('.nt-node + circle, .nt-node ~ circle').forEach(circle => {
    circle.style.pointerEvents = 'none';
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

  if (node.dynamic === 'modem') {
    if (!ptState.modem) return 'unknown';
    return ptState.modem.online ? 'ok' : 'error';
  }
  if (node.dynamic === 'router') {
    if (!ptState.router) return 'unknown';
    return ptState.router.online ? 'ok' : 'error';
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

  // 起点/终点严格在边的中点（不能是角）
  // 只有线明显水平（|dx| > 2*|dy|）时用左右边，否则用上下边
  // 这样从上往下的连接自然从上边中点进入
  if (Math.abs(dx) > Math.abs(dy) * 2) {
    // 水平方向为主：从左右边中点出发，到左右边中点
    if (dx > 0) {
      sx = from.x + from.w;
      ex = to.x;
    } else {
      sx = from.x;
      ex = to.x + to.w;
    }
    sy = fcy;  // from 边中点
    ey = tcy;  // to 边中点
  } else {
    // 垂直方向为主（含中等斜度）：从上下边中点出发，到上下边中点
    if (dy > 0) {
      sy = from.y + from.h;
      ey = to.y;
    } else {
      sy = from.y;
      ey = to.y + to.h;
    }
    sx = fcx;  // from 边中点
    ex = tcx;  // to 边中点
  }

  return { sx, sy, ex, ey };
}

// ── Tooltip ──

function showTooltip(e, topology, getStatusFn, tooltipId) {
  topology = topology || TOPOLOGY;
  getStatusFn = getStatusFn || getNodeStatus;
  tooltipId = tooltipId || 'nt-tooltip';
  // 使用 currentTarget 而非 target，防止鼠标落在子元素（如圆点）上时取不到 data-node
  const nodeId = e.currentTarget.getAttribute('data-node');
  const node = topology.nodes.find(n => n.id === nodeId);
  if (!node) return;

  const status = getStatusFn(node);
  const statusText = status === 'ok' ? '正常' :
                     status === 'error' ? '异常' :
                     status === 'warn' ? '警告' :
                     status === 'unknown' ? '未知' : '静态';

  const portText = node.port ? `端口: ${node.port}` : '';
  const protoText = node.id === 'qbittorrent' ? '协议: TCP + UDP' : '';

  const tooltip = document.getElementById(tooltipId);
  let info = `<div class="nt-tt-name">${node.label.replace('\n', ' ')}</div>
    <div class="nt-tt-info">状态: ${statusText}</div>
    ${portText ? `<div class="nt-tt-info">${portText}</div>` : ''}
    ${protoText ? `<div class="nt-tt-info">${protoText}</div>` : ''}`;

  // 物理拓扑额外信息
  if (node.id === 'modem' && ptState.modem) {
    info += `<div class="nt-tt-info">IP: ${ptState.modem.ip}  ·  延迟: ${ptState.modem.latency !== null ? ptState.modem.latency.toFixed(1) + 'ms' : '-'}</div>`;
    info += `<div class="nt-tt-info">CMCC ONT  ·  LAN×${ptState.modem.ports.lan}  POTS×${ptState.modem.ports.pots}</div>`;
  }
  if (node.id === 'router' && ptState.router) {
    const r = ptState.router;
    info += `<div class="nt-tt-info">${r.model || '小米路由器'}  ·  固件 ${r.firmware || '-'}</div>`;
    if (r.uptime) info += `<div class="nt-tt-info">运行: ${formatUptime(r.uptime)}</div>`;
    if (r.cpu) info += `<div class="nt-tt-info">CPU: ${r.cpu.load}% (${r.cpu.core}核)  ·  内存: ${r.mem ? (r.mem.usage * 100).toFixed(0) + '% / ' + r.mem.total : '-'}</div>`;
    if (r.wan) info += `<div class="nt-tt-info">WAN: ↓${formatSpeed(r.wan.down)} ↑${formatSpeed(r.wan.up)}</div>`;
  }

  tooltip.innerHTML = info;
  tooltip.style.display = 'block';
  // 添加 visible 类触发 CSS opacity 过渡（CSS 中 .nt-tooltip 默认 opacity:0）
  tooltip.classList.add('visible');

  const container = e.currentTarget.closest('.nt-diagram');
  const rect = container.getBoundingClientRect();
  tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
  tooltip.style.top = (e.clientY - rect.top - 40) + 'px';
}

function hideTooltip(tooltipId) {
  const tooltip = document.getElementById(tooltipId || 'nt-tooltip');
  if (!tooltip) return;
  tooltip.classList.remove('visible');
  tooltip.style.display = 'none';
}

function refreshPage() {
  loadNetworkTopology();
}

loadNetworkTopology();

// ── 物理拓扑 ──

let ptState = { modem: null, router: null, n150: null };

// 物理拓扑 = 网络拓扑全部节点下移 130px + 前插光猫和路由器
const PHYSICAL_TOPOLOGY = (function() {
  const shift = 130;
  const shifted = TOPOLOGY.nodes.map(n => ({
    ...n,
    y: n.y + shift,
  }));
  // Internet 节点保持原位置
  shifted.find(n => n.id === 'internet').y = 30;

  const nodes = [
    { id: 'modem',   label: '光猫',   x: 470, y: 100, w: 120, h: 44, dynamic: 'modem' },
    { id: 'router',  label: '路由器', x: 465, y: 175, w: 130, h: 44, dynamic: 'router' },
    ...shifted,
  ];

  const edges = [
    { from: 'internet', to: 'modem',   style: 'solid', label: '' },
    { from: 'modem',    to: 'router',  style: 'solid', label: '' },
    { from: 'router',   to: 'cf-cdn',  style: 'solid', label: 'HTTPS' },
    { from: 'router',   to: 'ufw',     style: 'solid', label: '直连' },
    ...TOPOLOGY.edges.filter(e => !(e.from === 'internet' && (e.to === 'cf-cdn' || e.to === 'ufw'))),
  ];

  return { nodes, edges };
})();

const PT_LAYERS = [
  { y: 30,  h: 44, label: '外部' },
  { y: 100, h: 44, label: '接入' },
  { y: 175, h: 44, label: '路由' },
  { y: 260, h: 44, label: '入口' },
  { y: 370, h: 52, label: '隧道' },
  { y: 550, h: 44, label: '服务' },
];

const PT_SEPARATORS = [87, 157, 237, 337, 486];

async function loadPhysicalTopology() {
  const container = document.getElementById('nt-diagram');
  if (!container) return;
  container.innerHTML = '<div class="nt-loading">加载网络拓扑...</div>';

  // 并行获取：物理拓扑数据 + 网络拓扑状态
  const [ptResult, ...ntResults] = await Promise.allSettled([
    api('/physical-topology'),
    api('/firewall/status'),
    api('/tunnel/status'),
    api('/health'),
  ]);

  // 物理拓扑数据
  if (ptResult.status === 'fulfilled' && ptResult.value) {
    ptState = ptResult.value;
  } else {
    ptState = { error: true, modem: null, router: null };
  }

  // 同时更新 ntState（物理拓扑需要检查 tunnel/firewall 状态）
  ntState.firewall = ntResults[0].status === 'fulfilled' ? ntResults[0].value : null;
  ntState.tunnel   = ntResults[1].status === 'fulfilled' ? ntResults[1].value : null;
  ntState.health   = ntResults[2].status === 'fulfilled' ? ntResults[2].value : [];

  updatePtBadge();
  renderTopology(container, {
    topology: PHYSICAL_TOPOLOGY,
    state: ntState,
    W: 1100,
    H: 630,
    layers: PT_LAYERS,
    separators: PT_SEPARATORS,
    tooltipId: 'nt-tooltip',
    arrowPrefix: 'pt-',
    getNodeStatusFn: getNodeStatus,
  });
}

function updatePtBadge() {
  const badge = document.getElementById('nt-status-badge');
  if (!badge) return;
  if (ptState.error || !ptState.modem) {
    badge.className = 'status-badge status-unhealthy';
    badge.textContent = '数据获取失败';
    return;
  }
  const allOnline = ptState.modem.online && ptState.router.online;
  badge.className = allOnline ? 'status-badge status-healthy' : 'status-badge status-warning';
  badge.textContent = allOnline ? '全部在线' : '部分离线';
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
