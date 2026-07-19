/* ===================================================
   WeMonitor — CI/CD 拓扑图
   =================================================== */

// ── 静态拓扑定义 ──

// Canvas: W=1100, H=550
// 5 层结构（自上而下）：源码 → 构建 → 发布 → 部署通道 → 运行服务
// 3 列并行 pipeline，在 L4 汇聚到 Webhook，再分发到 L5 服务

const CICD_TOPOLOGY = {
  nodes: [
    // Layer 1: 源码仓库
    { id: 'repo-wemusic',    label: 'WeMusic\n仓库',    x: 80,  y: 20,  w: 160, h: 48, service: 'wemusic' },
    { id: 'repo-wemonitor',  label: 'WeMonitor\n仓库',  x: 320, y: 20,  w: 160, h: 48, service: 'wemonitor' },
    { id: 'repo-wedownload', label: 'WeDownload\n仓库', x: 560, y: 20,  w: 160, h: 48, service: 'wedownload' },

    // Layer 2: GitHub Actions CI
    { id: 'ci-wemusic',    label: 'GitHub\nActions',  x: 80,  y: 120, w: 160, h: 48, service: 'wemusic' },
    { id: 'ci-wemonitor',  label: 'GitHub\nActions',  x: 320, y: 120, w: 160, h: 48, service: 'wemonitor' },
    { id: 'ci-wedownload', label: 'GitHub\nActions',  x: 560, y: 120, w: 160, h: 48, service: 'wedownload' },

    // Layer 3: GitHub Releases
    { id: 'release-wemusic',    label: 'GitHub\nRelease',  x: 80,  y: 220, w: 160, h: 48, service: 'wemusic' },
    { id: 'release-wemonitor',  label: 'GitHub\nRelease',  x: 320, y: 220, w: 160, h: 48, service: 'wemonitor' },
    { id: 'release-wedownload', label: 'GitHub\nRelease',  x: 560, y: 220, w: 160, h: 48, service: 'wedownload' },

    // Layer 4: 部署通道
    { id: 'cf-tunnel',    label: 'Cloudflare\nTunnel',    x: 30,  y: 330, w: 170, h: 52 },
    { id: 'webhook',      label: 'Webhook',               x: 260, y: 330, w: 150, h: 48, port: 9001 },
    { id: 'deploy-agent', label: 'Deploy\nAgent',         x: 490, y: 330, w: 150, h: 52 },

    // Layer 5: 运行服务
    { id: 'svc-wemusic',    label: 'WeMusic',     x: 80,  y: 440, w: 170, h: 48, dynamic: 'deploy', port: 5174,  service: 'wemusic' },
    { id: 'svc-wemonitor',  label: 'WeMonitor',   x: 320, y: 440, w: 170, h: 48, dynamic: 'deploy', port: 18990, service: 'wemonitor' },
    { id: 'svc-wedownload', label: 'WeDownload',  x: 560, y: 440, w: 170, h: 48, dynamic: 'deploy', port: 8080,  service: 'wedownload' },
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
    { from: 'deploy-agent', to: 'svc-wemusic',    style: 'solid', label: ':5174' },
    { from: 'deploy-agent', to: 'svc-wemonitor',  style: 'solid', label: ':18990' },
    { from: 'deploy-agent', to: 'svc-wedownload', style: 'solid', label: ':8080' },
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
  const H = 530;

  const layers = [
    { y: 20,  h: 48, label: '源码' },
    { y: 120, h: 48, label: '构建' },
    { y: 220, h: 48, label: '发布' },
    { y: 330, h: 52, label: '部署通道' },
    { y: 440, h: 48, label: '服务' },
  ];

  let svg = `<svg class="nt-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  // 层级分隔线
  [98, 200, 302, 418].forEach(y => {
    svg += `<line x1="40" y1="${y}" x2="${W - 10}" y2="${y}" stroke="var(--border-light)" stroke-width="1" stroke-dasharray="2,4"/>`;
  });

  // 层级标签（左侧）
  layers.forEach(layer => {
    svg += `<text x="12" y="${layer.y + layer.h / 2 + 5}" class="nt-layer-label">${layer.label}</text>`;
  });

  // 定义箭头 marker
  svg += `<defs>
    <marker id="cicd-arrow-green" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--success)"/>
    </marker>
    <marker id="cicd-arrow-dim" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--text-dim)"/>
    </marker>
    <marker id="cicd-arrow-danger" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--danger)"/>
    </marker>
    <marker id="cicd-arrow-warn" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--warning)"/>
    </marker>
  </defs>`;

  // 渲染连线
  for (const edge of CICD_TOPOLOGY.edges) {
    const from = CICD_TOPOLOGY.nodes.find(n => n.id === edge.from);
    const to = CICD_TOPOLOGY.nodes.find(n => n.id === edge.to);
    if (!from || !to) continue;

    const { sx, sy, ex, ey } = computeCicdEdgeEndpoints(from, to);

    let color = 'var(--text-dim)';
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

    svg += `<line x1="${sx}" y1="${sy}" x2="${ex2}" y2="${ey2}" stroke="${color}" stroke-width="2" ${dash} marker-end="${marker}"/>`;

    // 连线标签
    if (edge.label) {
      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2;
      const isHorizontal = Math.abs(ex - sx) > Math.abs(ey - sy);
      const labelOffsetX = isHorizontal ? 0 : -10;
      const labelOffsetY = isHorizontal ? -10 : 0;
      const lines = edge.label.split('\n');
      const textWidth = Math.max(...lines.map(l => l.length)) * 6;
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
  for (const node of CICD_TOPOLOGY.nodes) {
    const status = getCicdNodeStatus(node);
    const borderColor = status === 'ok' ? 'var(--success)' :
                        status === 'error' ? 'var(--danger)' :
                        status === 'warn' ? 'var(--warning)' : 'var(--border)';
    const bgColor = status === 'error' ? 'var(--danger-bg)' :
                    status === 'warn' ? 'var(--warning-bg)' : 'var(--bg-card)';

    // 背景矩形
    svg += `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="var(--radius)" fill="${bgColor}" stroke="${borderColor}" stroke-width="2" class="nt-node" data-node="${node.id}"/>`;

    // 状态圆点（仅 dynamic 节点显示）
    if (node.dynamic) {
      const dotX = node.x + node.w - 14;
      const dotY = node.y + node.h / 2;
      const dotColor = status === 'ok' ? 'var(--success)' :
                       status === 'error' ? 'var(--danger)' :
                       status === 'warn' ? 'var(--warning)' : 'var(--text-dim)';
      svg += `<circle cx="${dotX}" cy="${dotY}" r="5" fill="${dotColor}"/>`;
    }

    // 节点标签
    const labelLines = node.label.split('\n');
    const textX = node.x + 22;
    const textY = node.y + node.h / 2 - (labelLines.length - 1) * 7;
    labelLines.forEach((l, i) => {
      svg += `<text x="${textX}" y="${textY + i * 14}" class="nt-node-label">${l}</text>`;
    });

    // 端口号
    if (node.port) {
      svg += `<text x="${node.x + node.w - 24}" y="${node.y + 14}" text-anchor="end" class="nt-port-label">:${node.port}</text>`;
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
    // Release 节点：有远端的 release version 就显示 ok
    if (node.id.startsWith('release-') && svc.remote && svc.remote.release) return 'ok';
    // CI 节点：有远端的 CI 状态就显示 ok
    if (node.id.startsWith('ci-') && svc.remote && svc.remote.ci) return 'ok';
    // 仓库节点：有远程数据就显示 ok
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
    sy = Math.max(from.y + 4, Math.min(from.y + from.h - 4, sy));
    ey = Math.max(to.y + 4, Math.min(to.y + to.h - 4, ey));
  } else {
    if (dy > 0) { sy = from.y + from.h; ey = to.y; }
    else        { sy = from.y;          ey = to.y + to.h; }
    sx = fcx + (sy - fcy) * (dx / Math.abs(dy || 1));
    ex = tcx + (ey - tcy) * (dx / Math.abs(dy || 1));
    sx = Math.max(from.x + 4, Math.min(from.x + from.w - 4, sx));
    ex = Math.max(to.x + 4, Math.min(to.x + to.w - 4, ex));
  }

  return { sx, sy, ex, ey };
}

// ── Tooltip ──

function showCicdTooltip(e) {
  const nodeId = e.target.getAttribute('data-node');
  const node = CICD_TOPOLOGY.nodes.find(n => n.id === nodeId);
  if (!node) return;

  let statusText = '静态节点';
  let extraInfo = '';

  const svc = node.service ? cicdState.services.find(s => s.id === node.service) : null;

  if (node.dynamic === 'deploy' && svc) {
    const summaryMap = {
      'up-to-date': '最新',
      'update-available': '可更新',
      'deploying': '部署中',
      'error': '异常',
      'stopped': '已停止',
    };
    statusText = summaryMap[svc.summary] || svc.summary || '未知';
    if (svc.local && svc.local.version) {
      extraInfo += `<div class="nt-tt-info">本地: ${svc.local.version.slice(0, 8)}</div>`;
    }
    if (svc.remote && svc.remote.release && svc.remote.release.version) {
      extraInfo += `<div class="nt-tt-info">远端: ${svc.remote.release.version.slice(0, 8)}</div>`;
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
    extraInfo += `<div class="nt-tt-info">端口: ${node.port}</div>`;
  }

  const tooltip = document.getElementById('cicd-tooltip');
  if (!tooltip) return;

  tooltip.innerHTML = `
    <div class="nt-tt-name">${node.label.replace(/\n/g, ' ')}</div>
    <div class="nt-tt-info">状态: ${statusText}</div>
    ${extraInfo}
  `;
  tooltip.style.display = 'block';

  const container = document.getElementById('cicd-diagram');
  const rect = container.getBoundingClientRect();
  tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
  tooltip.style.top = (e.clientY - rect.top - 40) + 'px';
}

function hideCicdTooltip() {
  const tooltip = document.getElementById('cicd-tooltip');
  if (tooltip) tooltip.style.display = 'none';
}

loadCicdTopology();
