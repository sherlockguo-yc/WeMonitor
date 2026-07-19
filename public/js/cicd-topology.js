/* ===================================================
   WeMonitor — CI/CD 拓扑图
   =================================================== */

// ── 静态拓扑定义 ──

// Canvas: W=1100, H=550
// 5 层结构（自上而下）：源码 → 构建 → 发布 → 部署 → 服务
// 3 列并行 pipeline，在 L4 汇聚到 Webhook，再分发到 L5 服务
// L4: Webhook 位于左列与中列之间，Deploy Agent 位于中列与右列之间
//     让 Release→Webhook 和 Agent→服务 的线条从不同方向自然扇入，避免交叉

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

    // Layer 4: 部署
    { id: 'cf-tunnel',    label: 'Cloudflare\nTunnel',    x: 40,  y: 336, w: 162, h: 54 },
    { id: 'webhook',      label: 'Webhook',               x: 262, y: 338, w: 148, h: 50, port: 9001 },
    { id: 'deploy-agent', label: 'Deploy\nAgent',         x: 482, y: 336, w: 148, h: 54 },

    // Layer 5: 服务
    { id: 'svc-wemusic',    label: 'WeMusic',     x: 80,  y: 448, w: 170, h: 52, dynamic: 'deploy', port: 5174,  service: 'wemusic' },
    { id: 'svc-wemonitor',  label: 'WeMonitor',   x: 320, y: 448, w: 170, h: 52, dynamic: 'deploy', port: 18990, service: 'wemonitor' },
    { id: 'svc-wedownload', label: 'WeDownload',  x: 560, y: 448, w: 170, h: 52, dynamic: 'deploy', port: 8080,  service: 'wedownload' },
  ],

  edges: [
    // 源码 → CI
    { from: 'repo-wemusic',    to: 'ci-wemusic',    style: 'solid', label: '' },
    { from: 'repo-wemonitor',  to: 'ci-wemonitor',  style: 'solid', label: '' },
    { from: 'repo-wedownload', to: 'ci-wedownload', style: 'solid', label: '' },

    // CI → Release
    { from: 'ci-wemusic',    to: 'release-wemusic',    style: 'solid', label: '' },
    { from: 'ci-wemonitor',  to: 'release-wemonitor',  style: 'solid', label: '' },
    { from: 'ci-wedownload', to: 'release-wedownload', style: 'solid', label: '' },

    // Release → Webhook（CI 通知 N150）
    { from: 'release-wemusic',    to: 'webhook', style: 'dashed', label: '通知' },
    { from: 'release-wemonitor',  to: 'webhook', style: 'dashed', label: '' },
    { from: 'release-wedownload', to: 'webhook', style: 'dashed', label: '' },

    // Cloudflare Tunnel → Webhook（外部访问通道）
    { from: 'cf-tunnel', to: 'webhook', style: 'solid', label: 'TLS' },

    // Webhook → Deploy Agent
    { from: 'webhook', to: 'deploy-agent', style: 'solid', label: '' },

    // Deploy Agent → 服务（下载部署 + 重启）
    { from: 'deploy-agent', to: 'svc-wemusic',    style: 'solid', label: '' },
    { from: 'deploy-agent', to: 'svc-wemonitor',  style: 'solid', label: '' },
    { from: 'deploy-agent', to: 'svc-wedownload', style: 'solid', label: '' },
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

// ── 获取指定 service 的部署状态 ──

function getServiceState(serviceId) {
  const svc = cicdState.services.find(s => s.id === serviceId);
  return svc ? svc.summary : 'unknown';
}

// ── 渲染 SVG ──

function renderCicdTopology(container) {
  const W = 1100;
  const H = 540;

  const layers = [
    { y: 20,  h: 50, label: '源码' },
    { y: 122, h: 50, label: '构建' },
    { y: 224, h: 50, label: '发布' },
    { y: 336, h: 54, label: '部署' },
    { y: 448, h: 52, label: '服务' },
  ];

  let svg = `<svg class="nt-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  // 层级分隔线 — 更细腻的虚线
  [100, 204, 310, 420].forEach(y => {
    svg += `<line x1="38" y1="${y}" x2="${W - 10}" y2="${y}" stroke="var(--border-light)" stroke-width="1" stroke-dasharray="3,5" opacity="0.7"/>`;
  });

  // 层级标签
  layers.forEach(layer => {
    svg += `<text x="32" y="${layer.y + layer.h / 2 + 4.5}" text-anchor="end" class="nt-layer-label">${layer.label}</text>`;
  });

  // 定义箭头 marker — 更精致的箭头
  svg += `<defs>
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

    <!-- 节点阴影滤镜 -->
    <filter id="nt-node-shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#000" flood-opacity="0.06"/>
    </filter>
    <filter id="nt-node-shadow-hover" x="-15%" y="-15%" width="130%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#6366f1" flood-opacity="0.12"/>
    </filter>

    <!-- 成功节点微光 -->
    <linearGradient id="nt-glow-ok" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ecfdf5"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <!-- 警告节点渐变 -->
    <linearGradient id="nt-glow-warn" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fffbeb"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <!-- 错误节点渐变 -->
    <linearGradient id="nt-glow-error" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef2f2"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <!-- 默认节点 -->
    <linearGradient id="nt-glow-default" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fafbfc"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
  </defs>`;

  // 渲染连线
  for (const edge of CICD_TOPOLOGY.edges) {
    const from = CICD_TOPOLOGY.nodes.find(n => n.id === edge.from);
    const to = CICD_TOPOLOGY.nodes.find(n => n.id === edge.to);
    if (!from || !to) continue;

    const { sx, sy, ex, ey } = computeCicdEdgeEndpoints(from, to);

    let color = '#b8bac4';
    let dash = '';
    let marker = 'url(#cicd-arrow-dim)';

    if (edge.style === 'dashed') dash = 'stroke-dasharray="6,4"';
    if (edge.style === 'dotted') dash = 'stroke-dasharray="3,3"';

    // 根据目标服务节点状态调整连线颜色
    const targetSvc = to.service;
    if (targetSvc) {
      const state = getServiceState(targetSvc);
      if (state === 'up-to-date') {
        color = 'var(--success)';
        marker = 'url(#cicd-arrow-green)';
      } else if (state === 'error' || state === 'stopped') {
        color = 'var(--danger)';
        marker = 'url(#cicd-arrow-danger)';
      } else if (state === 'deploying' || state === 'update-available') {
        color = 'var(--warning)';
        marker = 'url(#cicd-arrow-warn)';
      }
    }

    // 箭头收尾缩短
    const angle = Math.atan2(ey - sy, ex - sx);
    const shortenEnd = 4;
    const ex2 = ex - shortenEnd * Math.cos(angle);
    const ey2 = ey - shortenEnd * Math.sin(angle);

    svg += `<line x1="${sx}" y1="${sy}" x2="${ex2}" y2="${ey2}" stroke="${color}" stroke-width="1.8" ${dash} marker-end="${marker}" opacity="0.85"/>`;

    // 连线标签
    if (edge.label) {
      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2;
      const isHorizontal = Math.abs(ex - sx) > Math.abs(ey - sy);
      const labelOffsetX = isHorizontal ? 0 : -10;
      const labelOffsetY = isHorizontal ? -11 : 0;
      const lines = edge.label.split('\n');
      const textWidth = Math.max(...lines.map(l => l.length)) * 6;
      const labelH = lines.length * 13 + 6;
      const labelW = textWidth + 12;
      const labelX = mx + labelOffsetX - labelW / 2;
      const labelY = my + labelOffsetY - lines.length * 6.5;
      svg += `<rect x="${labelX}" y="${labelY - labelH / 2}" width="${labelW}" height="${labelH}" fill="var(--bg-card)" rx="4" stroke="var(--border-light)" stroke-width="0.8"/>`;
      lines.forEach((l, i) => {
        svg += `<text x="${mx + labelOffsetX}" y="${my + labelOffsetY + (i - (lines.length - 1) / 2) * 13}" text-anchor="middle" class="nt-edge-label">${l}</text>`;
      });
    }
  }

  // 渲染节点（带入场动画延迟）
  for (let ni = 0; ni < CICD_TOPOLOGY.nodes.length; ni++) {
    const node = CICD_TOPOLOGY.nodes[ni];
    const status = getCicdNodeStatus(node);
    const borderColor = status === 'ok' ? 'var(--success)' :
                        status === 'error' ? 'var(--danger)' :
                        status === 'warn' ? 'var(--warning)' : '#d4d6dc';

    // 根据状态选择背景渐变
    const fillId = status === 'error' ? 'nt-glow-error' :
                   status === 'warn' ? 'nt-glow-warn' :
                   status === 'ok' ? 'nt-glow-ok' : 'nt-glow-default';

    // 入场动画延迟：按层递增
    const layerIdx = Math.floor(ni / 3);
    const delay = (layerIdx * 60 + (ni % 3) * 30);

    // 背景矩形 — 带阴影和动画
    svg += `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}"
      rx="10" ry="10"
      fill="url(#${fillId})"
      stroke="${borderColor}" stroke-width="1.8"
      class="nt-node nt-node-animate" data-node="${node.id}"
      filter="url(#nt-node-shadow)"
      style="animation-delay: ${delay}ms"/>`;

    // 状态圆点（仅 dynamic 节点显示）— 带脉冲效果
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

    // 节点标签
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

    // 端口号（非部署节点）
    if (node.port && node.dynamic !== 'deploy') {
      svg += `<text x="${node.x + node.w - 22}" y="${node.y + 14}" text-anchor="end" class="nt-port-label">:${node.port}</text>`;
    }
  }

  svg += `</svg>`;
  svg += `<div id="cicd-tooltip" class="nt-tooltip" style="display:none;"></div>`;

  container.innerHTML = svg;

  // 绑定 hover 事件
  container.querySelectorAll('.nt-node').forEach(rect => {
    rect.addEventListener('mouseenter', showCicdTooltip);
    rect.addEventListener('mouseleave', hideCicdTooltip);
  });
}

// ── 节点状态判断 ──

function getCicdNodeStatus(node) {
  if (!node.dynamic && !node.service) return 'static';

  // 动态部署节点（L5 服务）
  if (node.dynamic === 'deploy') {
    const state = getServiceState(node.service);
    if (state === 'up-to-date') return 'ok';
    if (state === 'deploying' || state === 'update-available') return 'warn';
    if (state === 'error' || state === 'stopped') return 'error';
    return 'unknown';
  }

  // 有 service 属性的静态节点：根据关联服务的远端状态决定颜色
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

// ── 连线端点计算 ──

function computeCicdEdgeEndpoints(from, to) {
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

    // 状态图标颜色
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

  // 延迟显示动画
  clearTimeout(tooltipTimer);
  tooltip.classList.remove('visible');
  tooltipTimer = setTimeout(() => {
    tooltip.classList.add('visible');
  }, 20);

  const container = document.getElementById('cicd-diagram');
  const rect = container.getBoundingClientRect();
  const ttRect = tooltip.getBoundingClientRect();

  // 智能定位：避免溢出
  let left = e.clientX - rect.left + 16;
  let top = e.clientY - rect.top - 36;

  // 右边界检测
  if (left + ttRect.width > rect.width - 10) {
    left = e.clientX - rect.left - ttRect.width - 16;
  }
  // 上边界检测
  if (top < 5) top = 8;
  // 下边界检测
  if (top + ttRect.height > rect.height - 5) {
    top = rect.height - ttRect.height - 8;
  }

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideCicdTooltip() {
  clearTimeout(tooltipTimer);
  const tooltip = document.getElementById('cicd-tooltip');
  if (!tooltip) return;
  tooltip.classList.remove('visible');
  // 完全隐藏前等待淡出完成
  setTimeout(() => {
    if (!tooltip.classList.contains('visible')) {
      tooltip.style.display = 'none';
    }
  }, 200);
}

loadCicdTopology();
