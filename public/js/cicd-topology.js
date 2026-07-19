/* ===================================================
   WeMonitor — CI/CD 拓扑图
   =================================================== */

// ── 静态拓扑定义 ──
// Canvas: W=1100, H=560
// 5 层结构：源码 → 构建 → 发布 → 部署 → 服务
// L4 部署层 3 个节点横向排列，L3→L4 用正交折线避免交叉

const CICD_TOPOLOGY = {
  nodes: [
    // Layer 1: 源码仓库
    { id: 'repo-wemusic',    label: 'WeMusic\n仓库',    x: 80,  y: 20,  w: 160, h: 50, service: 'wemusic' },
    { id: 'repo-wemonitor',  label: 'WeMonitor\n仓库',  x: 320, y: 20,  w: 160, h: 50, service: 'wemonitor' },
    { id: 'repo-wedownload', label: 'WeDownload\n仓库', x: 560, y: 20,  w: 160, h: 50, service: 'wedownload' },

    // Layer 2: GitHub Actions CI
    { id: 'ci-wemusic',    label: 'GitHub\nActions',  x: 80,  y: 122, w: 160, h: 50, service: 'wemusic' },
    { id: 'ci-wemonitor',  label: 'GitHub\nActions',  x: 320, y: 122, w: 160, h: 50, service: 'wemonitor' },
    { id: 'ci-wedownload', label: 'GitHub\nActions',  x: 560, y: 122, w: 160, h: 50, service: 'wedownload' },

    // Layer 3: GitHub Releases
    { id: 'release-wemusic',    label: 'GitHub\nRelease',  x: 80,  y: 224, w: 160, h: 50, service: 'wemusic' },
    { id: 'release-wemonitor',  label: 'GitHub\nRelease',  x: 320, y: 224, w: 160, h: 50, service: 'wemonitor' },
    { id: 'release-wedownload', label: 'GitHub\nRelease',  x: 560, y: 224, w: 160, h: 50, service: 'wedownload' },

    // Layer 4: 部署（3 个节点均匀分布）
    { id: 'cf-tunnel',    label: 'Cloudflare\nTunnel',    x: 40,  y: 340, w: 162, h: 54 },
    { id: 'webhook',      label: 'Webhook',               x: 262, y: 342, w: 148, h: 50, port: 9001 },
    { id: 'deploy-agent', label: 'Deploy\nAgent',         x: 482, y: 340, w: 148, h: 54 },

    // Layer 5: 服务
    { id: 'svc-wemusic',    label: 'WeMusic',     x: 80,  y: 488, w: 170, h: 52, dynamic: 'deploy', port: 5174,  service: 'wemusic' },
    { id: 'svc-wemonitor',  label: 'WeMonitor',   x: 320, y: 488, w: 170, h: 52, dynamic: 'deploy', port: 18990, service: 'wemonitor' },
    { id: 'svc-wedownload', label: 'WeDownload',  x: 560, y: 488, w: 170, h: 52, dynamic: 'deploy', port: 8080,  service: 'wedownload' },
  ],

  // routing: 'direct' = 直线（1:1 垂直管道）, 'ortho' = 正交折线（fan-in/fan-out）
  edges: [
    // ── 管道连线（垂直，直线） ──
    { from: 'repo-wemusic',    to: 'ci-wemusic',          style: 'solid', routing: 'direct' },
    { from: 'repo-wemonitor',  to: 'ci-wemonitor',        style: 'solid', routing: 'direct' },
    { from: 'repo-wedownload', to: 'ci-wedownload',       style: 'solid', routing: 'direct' },
    { from: 'ci-wemusic',     to: 'release-wemusic',      style: 'solid', routing: 'direct' },
    { from: 'ci-wemonitor',   to: 'release-wemonitor',    style: 'solid', routing: 'direct' },
    { from: 'ci-wedownload',  to: 'release-wedownload',   style: 'solid', routing: 'direct' },

    // ── Fan-in: Release → Webhook（正交折线） ──
    { from: 'release-wemusic',    to: 'webhook',           style: 'dashed', routing: 'ortho', label: '通知' },
    { from: 'release-wemonitor',  to: 'webhook',           style: 'dashed', routing: 'ortho' },
    { from: 'release-wedownload', to: 'webhook',           style: 'dashed', routing: 'ortho' },

    // ── Cloudflare Tunnel → Webhook（水平短线） ──
    { from: 'cf-tunnel', to: 'webhook',                    style: 'solid', routing: 'direct', label: 'TLS' },

    // ── Webhook → Deploy Agent（水平） ──
    { from: 'webhook', to: 'deploy-agent',                style: 'solid', routing: 'direct' },

    // ── Fan-out: Deploy Agent → 服务（正交折线） ──
    { from: 'deploy-agent', to: 'svc-wemusic',            style: 'solid', routing: 'ortho' },
    { from: 'deploy-agent', to: 'svc-wemonitor',          style: 'solid', routing: 'ortho' },
    { from: 'deploy-agent', to: 'svc-wedownload',         style: 'solid', routing: 'ortho' },
  ],
};

// ── 动态状态 ──

let cicdState = { services: [] };

async function loadCicdTopology() {
  const container = document.getElementById('cicd-diagram');
  container.innerHTML = '<div class="nt-loading">加载 CI/CD 拓扑...</div>';

  try {
    const result = await api('/deploy/status');
    cicdState.services = result.services || [];
  } catch (e) {
    cicdState.services = [];
  }

  updateCicdBadge();
  renderCicdTopology(container);
}

function updateCicdBadge() {
  const badge = document.getElementById('cicd-status-badge');
  if (!cicdState.services.length) {
    badge.className = 'status-badge status-unhealthy';
    badge.textContent = '数据获取失败';
    return;
  }

  const hasError = cicdState.services.some(s => s.summary === 'error' || s.summary === 'stopped');
  const hasPending = cicdState.services.some(s => s.summary === 'deploying' || s.summary === 'update-available');
  const allOk = cicdState.services.every(s => s.summary === 'up-to-date');

  if (allOk) {
    badge.className = 'status-badge status-healthy';
    badge.textContent = '全部最新';
  } else if (hasError) {
    badge.className = 'status-badge status-unhealthy';
    badge.textContent = '有异常';
  } else if (hasPending) {
    badge.className = 'status-badge status-warning';
    badge.textContent = '有待更新';
  } else {
    badge.className = 'status-badge';
    badge.textContent = '部分未知';
  }
}

function getServiceState(serviceId) {
  const svc = cicdState.services.find(s => s.id === serviceId);
  return svc ? svc.summary : 'unknown';
}

// ── 渲染 SVG ──

function renderCicdTopology(container) {
  const W = 1100;
  const H = 588;

  const layers = [
    { y: 20,  h: 50, label: '源码' },
    { y: 122, h: 50, label: '构建' },
    { y: 224, h: 50, label: '发布' },
    { y: 340, h: 54, label: '部署' },
    { y: 488, h: 52, label: '服务' },
  ];

  let svg = `<svg class="nt-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">`;

  // ── 层级分隔线 ──
  [100, 204, 310, 441].forEach(y => {
    svg += `<line x1="38" y1="${y}" x2="${W - 10}" y2="${y}" stroke="var(--border-light)" stroke-width="1" stroke-dasharray="3,6" opacity="0.65"/>`;
  });

  // ── 层级标签 ──
  layers.forEach(layer => {
    svg += `<text x="32" y="${layer.y + layer.h / 2 + 4.5}" text-anchor="end" class="nt-layer-label">${layer.label}</text>`;
  });

  // ── SVG defs ──
  svg += `<defs>
    <!-- 箭头 markers -->
    <marker id="cicd-arrow-green" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="9" markerHeight="6" orient="auto">
      <path d="M0 0 L10 3.5 L0 7 z" fill="var(--success)"/>
    </marker>
    <marker id="cicd-arrow-dim" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="9" markerHeight="6" orient="auto">
      <path d="M0 0 L10 3.5 L0 7 z" fill="#b8bac4"/>
    </marker>
    <marker id="cicd-arrow-danger" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="9" markerHeight="6" orient="auto">
      <path d="M0 0 L10 3.5 L0 7 z" fill="var(--danger)"/>
    </marker>
    <marker id="cicd-arrow-warn" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="9" markerHeight="6" orient="auto">
      <path d="M0 0 L10 3.5 L0 7 z" fill="var(--warning)"/>
    </marker>

    <!-- 节点阴影 -->
    <filter id="nt-node-shadow" x="-12%" y="-15%" width="124%" height="140%">
      <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#000" flood-opacity="0.06"/>
    </filter>

    <!-- 状态渐变背景 -->
    <linearGradient id="nt-glow-ok" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ecfdf5"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <linearGradient id="nt-glow-warn" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fffbeb"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <linearGradient id="nt-glow-error" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef2f2"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <linearGradient id="nt-glow-default" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fafbfc"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>

    <!-- 折线圆角半径（用于 path 的 Q 指令） -->
  </defs>`;

  // ════════════════════════════════════
  // 渲染连线（在节点下方）
  // ════════════════════════════════════
  for (const edge of CICD_TOPOLOGY.edges) {
    const from = CICD_TOPOLOGY.nodes.find(n => n.id === edge.from);
    const to = CICD_TOPOLOGY.nodes.find(n => n.id === edge.to);
    if (!from || !to) continue;

    // 颜色 & 样式
    let color = '#b8bac4';
    let marker = 'url(#cicd-arrow-dim)';
    const dashAttr = edge.style === 'dashed'
      ? 'stroke-dasharray="8,5"'
      : '';

    const targetSvc = to.service || (edge.routing === 'ortho' ? null : null);
    if (targetSvc) {
      const state = getServiceState(targetSvc);
      if (state === 'up-to-date')       { color = 'var(--success)'; marker = 'url(#cicd-arrow-green)'; }
      else if (state === 'error' || state === 'stopped') { color = 'var(--danger)'; marker = 'url(#cicd-arrow-danger)'; }
      else if (state === 'deploying' || state === 'update-available') { color = 'var(--warning)'; marker = 'url(#cicd-arrow-warn)'; }
    }

    // ── 计算路径 ──
    let pathData;
    let endX, endY; // 终点坐标（用于箭头方向计算）

    if (edge.routing === 'ortho') {
      const ortho = computeOrthoPath(from, to);
      pathData = ortho.d;
      endX = ortho.ex;
      endY = ortho.ey;
    } else {
      const ep = computeDirectEdge(from, to);
      pathData = `M${ep.sx},${ep.sy} L${ep.ex},${ep.ey}`;
      endX = ep.ex;
      endY = ep.ey;
    }

    svg += `<path d="${pathData}" stroke="${color}" stroke-width="1.8" fill="none"
              ${dashAttr} marker-end="${marker}" opacity="0.85"
              stroke-linecap="round" stroke-linejoin="round"/>`;

    // 连线标签
    if (edge.label) {
      // 对于正交路径，取路径中点附近；对于直线取中点
      let lx, ly;
      if (edge.routing === 'ortho') {
        const midIdx = Math.floor(getPathMidIndex(pathData));
        const pts = parsePathPoints(pathData);
        if (pts.length >= 2) {
          const mp = Math.min(midIdx, pts.length - 1);
          lx = pts[mp].x; ly = pts[mp].y - 11;
        } else {
          lx = (from.x + to.x) / 2; ly = (from.y + to.y) / 2 - 11;
        }
      } else {
        const ep = computeDirectEdge(from, to);
        lx = (ep.sx + ep.ex) / 2;
        ly = (ep.sy + ep.ey) / 2 - 11;
      }
      const lines = edge.label.split('\n');
      const textW = Math.max(...lines.map(l => l.length)) * 7;
      const labelH = lines.length * 13 + 8;
      svg += `<rect x="${lx - textW / 2 - 6}" y="${ly - labelH / 2}" width="${textW + 12}" height="${labelH}"
        fill="var(--bg-card)" rx="4" stroke="var(--border-light)" stroke-width="0.8"/>`;
      lines.forEach((l, i) => {
        svg += `<text x="${lx}" y="${ly + (i - (lines.length - 1) / 2) * 13 + 4}" text-anchor="middle" class="nt-edge-label">${l}</text>`;
      });
    }
  }

  // ════════════════════════════════════
  // 渲染节点（覆盖在连线上方）
  // ════════════════════════════════════
  for (let ni = 0; ni < CICD_TOPOLOGY.nodes.length; ni++) {
    const node = CICD_TOPOLOGY.nodes[ni];
    const status = getCicdNodeStatus(node);
    const borderColor = status === 'ok' ? 'var(--success)' :
                        status === 'error' ? 'var(--danger)' :
                        status === 'warn' ? 'var(--warning)' : '#d4d6dc';
    const fillId = status === 'error' ? 'nt-glow-error' :
                   status === 'warn' ? 'nt-glow-warn' :
                   status === 'ok' ? 'nt-glow-ok' : 'nt-glow-default';

    const layerIdx = Math.floor(ni / 3);
    const delay = (layerIdx * 60 + (ni % 3) * 30);

    svg += `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}"
      rx="10" ry="10"
      fill="url(#${fillId})"
      stroke="${borderColor}" stroke-width="1.8"
      class="nt-node nt-node-animate" data-node="${node.id}"
      filter="url(#nt-node-shadow)"
      style="animation-delay: ${delay}ms"/>`;

    // 状态圆点（仅 dynamic 节点）
    if (node.dynamic) {
      const dotX = node.x + node.w - 14;
      const dotY = node.y + node.h / 2;
      const dotColor = status === 'ok' ? 'var(--success)' :
                       status === 'error' ? 'var(--danger)' :
                       status === 'warn' ? 'var(--warning)' : '#b8bac4';
      const dotGlow = status === 'ok' ? 'rgba(16,185,129,0.25)' :
                      status === 'error' ? 'rgba(239,68,68,0.25)' :
                      status === 'warn' ? 'rgba(245,158,11,0.25)' : 'rgba(184,186,196,0.15)';
      svg += `<circle cx="${dotX}" cy="${dotY}" r="6" fill="${dotGlow}"/>`;
      svg += `<circle cx="${dotX}" cy="${dotY}" r="4.5" fill="${dotColor}">
        ${status === 'ok' ? `<animate attributeName="r" values="4.5;5.2;4.5" dur="2s" repeatCount="indefinite" begin="${delay}ms"/>` : ''}
        ${status === 'warn' ? `<animate attributeName="opacity" values="1;0.55;1" dur="1.2s" repeatCount="indefinite" begin="${delay}ms"/>` : ''}
      </circle>`;
    }

    // 标签文字
    let labelLines = node.label.split('\n');
    if (node.dynamic === 'deploy' && node.port) {
      labelLines = [...labelLines, `:${node.port}`];
    }
    const textX = node.x + 24;
    const textY = node.y + node.h / 2 - (labelLines.length - 1) * 7.5;
    labelLines.forEach((l, i) => {
      const cls = (i === labelLines.length - 1 && node.dynamic === 'deploy') ? 'nt-port-label' : 'nt-node-label';
      svg += `<text x="${textX}" y="${textY + i * 15}" class="${cls}">${l}</text>`;
    });

    if (node.port && node.dynamic !== 'deploy') {
      svg += `<text x="${node.x + node.w - 22}" y="${node.y + 14}" text-anchor="end" class="nt-port-label">:${node.port}</text>`;
    }
  }

  svg += `</svg>`;
  svg += `<div id="cicd-tooltip" class="nt-tooltip" style="display:none;"></div>`;

  container.innerHTML = svg;

  container.querySelectorAll('.nt-node').forEach(rect => {
    rect.addEventListener('mouseenter', showCicdTooltip);
    rect.addEventListener('mouseleave', hideCicdTooltip);
  });
}

// ── 节点状态判断 ──

function getCicdNodeStatus(node) {
  if (!node.dynamic && !node.service) return 'static';

  if (node.dynamic === 'deploy') {
    const state = getServiceState(node.service);
    if (state === 'up-to-date') return 'ok';
    if (state === 'deploying' || state === 'update-available') return 'warn';
    if (state === 'error' || state === 'stopped') return 'error';
    return 'unknown';
  }

  if (node.service && !node.dynamic) {
    const svc = cicdState.services.find(s => s.id === node.service);
    if (!svc) return 'static';
    if (node.id.startsWith('release-') && svc.remote && svc.remote.release) return 'ok';
    if (node.id.startsWith('ci-') && svc.remote && svc.remote.ci) return 'ok';
    if (node.id.startsWith('repo-') && svc.remote) return 'ok';
    return 'static';
  }

  return 'static';
}

// ════════════════════════════════════════════════
// 连线路由计算
// ════════════════════════════════════════════════

/**
 * 直接连线端点（用于 1:1 垂直管道）
 */
function computeDirectEdge(from, to) {
  const fcx = from.x + from.w / 2;
  const fcy = from.y + from.h / 2;
  const tcx = to.x + to.w / 2;
  const tcy = to.y + to.h / 2;

  const dx = tcx - fcx;
  const dy = tcy - fcy;

  let sx, sy, ex, ey;

  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > 0) { sx = from.x + from.w; ex = to.x; }
    else        { sx = from.x;          ex = to.x + to.w; }
    sy = fcy + (sx - fcx) * (dy / Math.abs(dx || 1));
    ey = tcy + (ex - tcx) * (dy / Math.abs(dx || 1));
    sy = Math.max(from.y + 5, Math.min(from.y + from.h - 5, sy));
    ey = Math.max(to.y + 5, Math.min(to.y + to.h - 5, ey));
  } else {
    if (dy > 0) { sy = from.y + from.h; ey = to.y; }
    else        { sy = from.y;          ey = to.y + to.h; }
    sx = fcx + (sy - fcy) * (dx / Math.abs(dy || 1));
    ex = tcx + (ey - tcy) * (dx / Math.abs(dy || 1));
    sx = Math.max(from.x + 5, Math.min(from.x + from.w - 5, sx));
    ex = Math.max(to.x + 5, Math.min(to.x + to.w - 5, ex));
  }

  return { sx, sy, ex, ey };
}

/** 圆角半径 */
const R = 10;

/**
 * 正交折线路由（用于 fan-in / fan-out）
 *
 * 策略：
 * - 从源节点底部中点出发，先向下走到中间层高度
 * - 再水平移动到目标节点上方
 * - 再向下进入目标节点顶部
 * - 所有拐角用 Q 指令画圆弧
 *
 * 多条同向线条通过不同的中间 Y 高度错开，避免重叠
 */
function computeOrthoPath(from, to) {
  const GAP = 16; // 同组线条的间距
  const PAD = 6;  // 与节点的最小间距

  // 判断这是 fan-in（多→一）还是 fan-out（一→多）
  const fanInEdges = CICD_TOPOLOGY.edges.filter(e =>
    e.routing === 'ortho' && e.to === to.id && e.from !== from.id
  );
  const fanOutEdges = CICD_TOPOLOGY.edges.filter(e =>
    e.routing === 'ortho' && e.from === from.id && e.to !== to.id
  );

  const isFanIn = fanInEdges.length > 0;
  const isFanOut = fanOutEdges.length > 0;

  // 起点：源节点底部
  const sx = from.x + from.w / 2;
  const sy = from.y + from.h + PAD;

  // 终点：目标节点顶部
  const ex = to.x + to.w / 2;
  const ey = to.y - PAD;

  if (isFanIn) {
    // Fan-in: Release → Webhook
    // 按 X 坐标排序确定索引
    const allFromIds = [from.id, ...fanInEdges.map(e => e.from)];
    const allFromNodes = allFromIds.map(id => CICD_TOPOLOGY.nodes.find(n => n.id === id)).sort((a, b) => a.x - b.x);
    const myIndex = allFromNodes.findIndex(n => n.id === from.id); // 0=左, 1=中, 2=右

    // 中间层 Y 坐标：根据索引错开，越靠右的线越高（避免交叉）
    const baseMidY = from.y + from.h + (to.y - (from.y + from.h)) / 2;
    const midY = baseMidY - (myIndex - 1) * GAP;

    // 水平段 X：目标节点顶部的入口偏移（按来源索引分散）
    const entryOffsets = [-40, 0, 40]; // 左/中/右偏移
    const targetX = ex + (entryOffsets[myIndex] || 0);

    // 构建正交路径：起点 → 向下到 midY → 水平到 targetX → 向下进入目标
    // 使用 Q 指令画圆角拐角
    const p1_y = midY;            // 第一段终点（竖直下）
    const p2_x = targetX;         // 第二段终点（水平横）
    const p3_x = targetX;         // 第三段起点（竖直下）

    // 如果 source 和 target 已经在同一列附近（如 WeMonitor→Webhook），直接斜线即可
    if (Math.abs(sx - ex) < 30) {
      return { d: `M${sx},${sy} L${ex},${ey}`, ex, ey };
    }

    const d = buildOrthoPath(sx, sy, p1_y, p2_x, p3_x, ey);
    return { d, ex, ey };

  } else if (isFanOut) {
    // Fan-out: Deploy Agent → 服务
    // 策略：先从源节点底部竖直向下引出（明显可见），再水平分叉到各服务，最后竖直进入
    const allToIds = [to.id, ...fanOutEdges.map(e => e.to)];
    const allToNodes = allToIds.map(id => CICD_TOPOLOGY.nodes.find(n => n.id === id)).sort((a, b) => a.x - b.x);
    const myIndex = allToNodes.findIndex(n => n.id === to.id); // 0=左, 1=中, 2=右

    // 中间层 Y：靠近服务层顶部，确保竖直引出段足够长（至少 35px）
    const baseMidY = to.y - 38;  // 在服务节点上方 38px 处开始水平分叉
    const midY = baseMidY - (Math.abs(myIndex - 1)) * (GAP * 0.6);

    // 如果已经在同一列附近，直接斜线
    if (Math.abs(sx - ex) < 30) {
      return { d: `M${sx},${sy} L${ex},${ey}`, ex, ey };
    }

    // 先竖直向下引出 → 水平分叉 → 竖直进入服务（startHorizontal=false）
    const d = buildOrthoPath(sx, sy, midY, ex, ex, ey);
    return { d, ex, ey };

  } else {
    // 一般情况 fallback：简单折线
    const midY = (sy + ey) / 2;
    return { d: buildOrthoPath(sx, sy, midY, ex, ex, ey), ex, ey };
  }
}

/**
 * 构建带圆角的正交路径
 *
 * @param sx,sy  起点
 * @param y1     第一个转折点 Y（从起点竖直到这里）
 * @param x2     第二个转折点 X（水平到这里）
 * @param x3     第三个转折点 X（从这里竖直到终点）
 * @param ey     终点 Y
 * @param startHorizontal 是否第一段先水平（默认先竖直）
 */
function buildOrthoPath(sx, sy, y1, x2, x3, ey, startHorizontal = false) {
  if (startHorizontal) {
    // 先水平再竖直：sx,sy → x2,sy → x2,y_mid → x3,y_mid → x3,ey
    const yMid = (sy + ey) / 2;
    return [
      `M${sx},${sy}`,
      `L${clampX(x2 - R, sx, x2)},${sy}`,
      `Q${x2},${sy} ${x2},${sy + R}`,
      `L${x2},${yMid - R}`,
      `Q${x2},${yMid} ${clampX(x3, x2, x3)},${yMid}`,
      `L${x3},${ey - R}`,
      `Q${x3},${ey} ${x3},${ey}`,
    ].join(' ');
  }

  // 先竖直再水平：sx,sy → sx,y1 → x2,y1 → x3,y1 → x3,ey
  // 但如果 x2 ≈ x3（即水平段长度很短），则简化为两段
  const hasShortHoriz = Math.abs(x2 - x3) < R * 2;

  if (hasShortHoriz) {
    // 两段：竖直 → 斜向进入
    const mx = (sx + x3) / 2;
    return [
      `M${sx},${sy}`,
      `L${sx},${y1 - R}`,
      `Q${sx},${y1} ${mx},${y1}`,
      `L${x3},${ey - R}`,
      `Q${x3},${ey} ${x3},${ey}`,
    ].join(' ');
  }

  return [
    `M${sx},${sy}`,
    `L${sx},${y1 - R}`,
    `Q${sx},${y1} ${clampX(sx + (sx < x2 ? R : -R), sx, x2)},${y1}`,
    `L${clampX(x2 + (x2 < x3 ? -R : R), sx, x3)},${y1}`,
    `Q${x2},${y1} ${x3},${y1}`,
    `L${x3},${ey - R}`,
    `Q${x3},${ey} ${x3},${ey}`,
  ].join(' ');
}

/** clamp 辅助 */
function clampX(val, lo, hi) {
  if (lo < hi) return Math.max(lo, Math.min(hi, val));
  return Math.max(hi, Math.min(lo, val));
}

/** 简易解析 path 的关键点（用于标签定位） */
function parsePathPoints(d) {
  const pts = [];
  const re = /[MLQ]\s*([-\d.]+)\s*,\s*([-\d.]+)/g;
  let m;
  while ((m = re.exec(d)) !== null) {
    pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
  }
  return pts;
}
function getPathMidIndex(d) {
  const cmds = (d.match(/[MLQ]/g) || []).length;
  return Math.floor(cmds / 2);
}

// ── Tooltip ──

let tooltipTimer = null;

function showCicdTooltip(e) {
  const nodeId = e.target.getAttribute('data-node');
  const node = CICD_TOPOLOGY.nodes.find(n => n.id === nodeId);
  if (!node) return;

  let statusText = '静态节点';
  let extraInfo = '';
  let statusIcon = '';

  const svc = node.service ? cicdState.services.find(s => s.id === node.service) : null;

  if (node.dynamic === 'deploy' && svc) {
    const summaryMap = {
      'up-to-date': '最新',
      'update-available': '可更新',
      'deploying': '部署中',
      'error': '异常',
      'stopped': '已停止',
    };
    const summaryKey = svc.summary;
    statusText = summaryMap[summaryKey] || summaryKey || '未知';

    const iconColor = summaryKey === 'up-to-date' ? 'var(--success)' :
                      summaryKey === 'error' || summaryKey === 'stopped' ? 'var(--danger)' :
                      summaryKey === 'deploying' || summaryKey === 'update-available' ? 'var(--warning)' : '#b8bac4';
    statusIcon = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${iconColor};flex-shrink:0;margin-right:6px;"></span>`;

    if (svc.local && svc.local.version) {
      extraInfo += `<div class="nt-tt-info"><span style="color:#8888a0">本地</span> <code style="font-family:var(--font-mono);font-size:0.92em;background:rgba(0,0,0,0.04);padding:1px 5px;border-radius:3px;">${svc.local.version.slice(0, 8)}</code></div>`;
    }
    if (svc.remote && svc.remote.release && svc.remote.release.version) {
      extraInfo += `<div class="nt-tt-info"><span style="color:#8888a0">远端</span> <code style="font-family:var(--font-mono);font-size:0.92em;background:rgba(0,0,0,0.04);padding:1px 5px;border-radius:3px;">${svc.remote.release.version.slice(0, 8)}</code></div>`;
    }
  } else if (svc) {
    if (node.id.startsWith('release-') && svc.remote && svc.remote.release) {
      statusText = `Release: ${svc.remote.release.version.slice(0, 8)}`;
    } else if (node.id.startsWith('ci-') && svc.remote && svc.remote.ci) {
      statusText = svc.remote.ci.status || 'CI 运行中';
    } else if (node.id.startsWith('repo-')) {
      statusText = svc.remote ? '已连接' : '未知';
    }
  }

  if (node.port) {
    extraInfo += `<div class="nt-tt-info"><span style="color:#8888a0">端口</span> <code style="font-family:var(--font-mono);font-size:0.92em;background:rgba(0,0,0,0.04);padding:1px 5px;border-radius:3px;">${node.port}</code></div>`;
  }

  const tooltip = document.getElementById('cicd-tooltip');
  if (!tooltip) return;

  tooltip.innerHTML = `
    <div style="display:flex;align-items:center;margin-bottom:calc(var(--font-size)*0.35);">
      ${statusIcon}
      <div class="nt-tt-name">${node.label.replace(/\n/g, ' ')}</div>
    </div>
    <div class="nt-tt-info" style="margin-bottom:${extraInfo ? 'calc(var(--font-size)*0.15)' : '0'};">
      <span style="color:#8888a0">状态</span> ${statusText}
    </div>
    ${extraInfo}
  `;

  tooltip.style.display = 'block';
  clearTimeout(tooltipTimer);
  tooltip.classList.remove('visible');
  tooltipTimer = setTimeout(() => { tooltip.classList.add('visible'); }, 20);

  const container = document.getElementById('cicd-diagram');
  const rect = container.getBoundingClientRect();
  const ttRect = tooltip.getBoundingClientRect();

  let left = e.clientX - rect.left + 16;
  let top = e.clientY - rect.top - 36;

  if (left + ttRect.width > rect.width - 10) left = e.clientX - rect.left - ttRect.width - 16;
  if (top < 5) top = 8;
  if (top + ttRect.height > rect.height - 5) top = rect.height - ttRect.height - 8;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideCicdTooltip() {
  clearTimeout(tooltipTimer);
  const tooltip = document.getElementById('cicd-tooltip');
  if (!tooltip) return;
  tooltip.classList.remove('visible');
  setTimeout(() => {
    if (!tooltip.classList.contains('visible')) tooltip.style.display = 'none';
  }, 200);
}

loadCicdTopology();
