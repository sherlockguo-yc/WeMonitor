/* ===================================================
   WeMonitor — 网络拓扑图（动态版，从配置读取）
   =================================================== */

let topoStatus = { physical: null, firewall: null, tunnel: null, health: [] };
let topoConfig = null;

async function loadNetworkTopology() {
  const container = document.getElementById('nt-diagram');
  container.innerHTML = '<div class="nt-loading">加载网络拓扑...</div>';

  try {
    const [confRes, ptRes, fwRes, tunnelRes, healthRes] = await Promise.allSettled([
      api('/topology-config'),
      api('/physical-topology'),
      api('/firewall/status'),
      api('/tunnel/status'),
      api('/health'),
    ]);

    if (confRes.status !== 'fulfilled' || !confRes.value) {
      container.innerHTML = '<div class="nt-loading">加载拓扑配置失败</div>';
      return;
    }

    topoConfig = confRes.value;
    topoStatus.physical = ptRes.status === 'fulfilled' ? ptRes.value : null;
    topoStatus.firewall = fwRes.status === 'fulfilled' ? fwRes.value : null;
    topoStatus.tunnel = tunnelRes.status === 'fulfilled' ? tunnelRes.value : null;
    topoStatus.health = healthRes.status === 'fulfilled' ? healthRes.value : [];

    updateStatusBadge();
    renderTopology(container);
  } catch (err) {
    container.innerHTML = '<div class="nt-loading">加载失败: ' + err.message + '</div>';
  }
}

// ── 节点状态计算 ──

function getNodeStatus(node) {
  const d = node.data || {};
  if (!d.dynamic) return 'static';

  switch (d.dynamic) {
    case 'modem':
      if (!topoStatus.physical?.modem) return 'unknown';
      return topoStatus.physical.modem.online ? 'ok' : 'error';
    case 'router':
      if (!topoStatus.physical?.router) return 'unknown';
      return topoStatus.physical.router.online ? 'ok' : 'error';
    case 'n150':
      if (!topoStatus.physical?.n150) return 'unknown';
      return topoStatus.physical.n150.online ? 'ok' : 'error';
    case 'firewall':
      if (!topoStatus.firewall) return 'unknown';
      return topoStatus.firewall.status === 'active' ? 'ok' : 'error';
    case 'tunnel':
      if (!topoStatus.tunnel) return 'unknown';
      return topoStatus.tunnel.active ? 'ok' : 'error';
    case 'health':
      if (d.healthIdx === -1) return 'ok';
      if (Array.isArray(topoStatus.health)) {
        const nameMap = { 0: 'WeMusic', 1: 'WeDownload' };
        const svc = topoStatus.health.find(h => h.name === nameMap[d.healthIdx]);
        if (!svc) return 'unknown';
        return svc.status === 'healthy' ? 'ok' : 'error';
      }
      return 'unknown';
  }
  return 'static';
}

// ── 连线端点计算 ──

function computeEdgeEndpoints(from, to) {
  const fw = from.data?.width || 140;
  const fh = 44;
  const tw = to.data?.width || 140;
  const th = 44;
  const fx = from.position.x, fy = from.position.y;
  const tx = to.position.x, ty = to.position.y;
  const fcx = fx + fw / 2, fcy = fy + fh / 2;
  const tcx = tx + tw / 2, tcy = ty + th / 2;
  const dx = tcx - fcx, dy = tcy - fcy;

  let sx, sy, ex, ey;
  if (Math.abs(dx) > Math.abs(dy) * 5) {
    if (dx > 0) { sx = fx + fw; ex = tx; }
    else { sx = fx; ex = tx + tw; }
    sy = fcy; ey = tcy;
  } else {
    if (dy > 0) { sy = fy + fh; ey = ty; }
    else { sy = fy; ey = ty + th; }
    sx = fcx; ex = tcx;
  }
  return { sx, sy, ex, ey };
}

// ── 渲染 SVG ──

function renderTopology(container) {
  if (!topoConfig) return;
  const { nodes, edges } = topoConfig;

  // 计算画布范围
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const w = n.data?.width || 140;
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + 44);
  }
  const pad = 40;
  const W = maxX - minX + pad * 2;
  const H = Math.max(maxY - minY + pad * 2, 400);
  const ox = minX - pad;
  const oy = minY - pad;

  let svg = `<svg class="nt-svg" viewBox="${ox} ${oy} ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;

  // 箭头 markers
  svg += `<defs>
    <marker id="arr-green" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--success)"/>
    </marker>
    <marker id="arr-dim" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--text-dim)"/>
    </marker>
    <marker id="arr-danger" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--danger)"/>
    </marker>
  </defs>`;

  // 渲染边
  for (const edge of edges) {
    const from = nodes.find(n => n.id === edge.source);
    const to = nodes.find(n => n.id === edge.target);
    if (!from || !to) continue;

    const ep = computeEdgeEndpoints(from, to);
    let color = 'var(--text-dim)', marker = 'url(#arr-dim)', dash = '';

    // 边颜色
    const fromStatus = getNodeStatus(from);
    if (fromStatus === 'ok') { color = 'var(--success)'; marker = 'url(#arr-green)'; }
    if (fromStatus === 'error') { color = 'var(--danger)'; marker = 'url(#arr-danger)'; }

    const angle = Math.atan2(ep.ey - ep.sy, ep.ex - ep.sx);
    const ex2 = ep.ex - 4 * Math.cos(angle);
    const ey2 = ep.ey - 4 * Math.sin(angle);

    svg += `<line x1="${ep.sx}" y1="${ep.sy}" x2="${ex2}" y2="${ey2}" stroke="${color}" stroke-width="2" ${dash} marker-end="${marker}"/>`;

    // 标签
    if (edge.label) {
      const mx = (ep.sx + ep.ex) / 2, my = (ep.sy + ep.ey) / 2;
      const isH = Math.abs(ep.ex - ep.sx) > Math.abs(ep.ey - ep.sy);
      const lx = mx + (isH ? 0 : -8), ly = my + (isH ? -8 : 0);
      const lines = edge.label.split('\n');
      const tw = Math.max(...lines.map(l => l.length)) * 6 + 10;
      const th = lines.length * 12 + 4;
      svg += `<rect x="${lx - tw / 2}" y="${ly - th / 2}" width="${tw}" height="${th}" fill="var(--bg-card)" rx="3"/>`;
      lines.forEach((l, i) => {
        svg += `<text x="${lx}" y="${ly + (i - (lines.length - 1) / 2) * 12}" text-anchor="middle" class="nt-edge-label">${l}</text>`;
      });
    }
  }

  // 渲染节点
  for (const node of nodes) {
    const d = node.data || {};
    const w = d.width || 140, h = 44;
    const x = node.position.x, y = node.position.y;
    const status = getNodeStatus(node);

    const bc = status === 'ok' ? 'var(--success)' : status === 'error' ? 'var(--danger)' : status === 'warn' ? 'var(--warning)' : 'var(--border)';
    const bg = status === 'error' ? 'var(--danger-bg)' : status === 'warn' ? 'var(--warning-bg)' : 'var(--bg-card)';

    svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="var(--radius)" fill="${bg}" stroke="${bc}" stroke-width="2" class="nt-node" data-node="${node.id}"/>`;

    // 状态圆点
    if (d.dynamic) {
      const dc = status === 'ok' ? 'var(--success)' : status === 'error' ? 'var(--danger)' : status === 'warn' ? 'var(--warning)' : 'var(--text-dim)';
      svg += `<circle cx="${x + w - 14}" cy="${y + h / 2}" r="5" fill="${dc}" style="pointer-events:none"/>`;
    }

    // 标签
    const lines = (d.label || '').split('\n');
    const tx = x + 30, ty = y + h / 2 - (lines.length - 1) * 7;
    lines.forEach((l, i) => {
      svg += `<text x="${tx}" y="${ty + i * 14}" class="nt-node-label">${l}</text>`;
    });

    // 端口
    if (d.port) {
      svg += `<text x="${x + w - 24}" y="${y + 12}" text-anchor="end" class="nt-port-label">:${d.port}</text>`;
    }
  }

  svg += '</svg>';

  // Tooltip
  svg += '<div id="nt-tooltip" class="nt-tooltip" style="display:none;"></div>';

  container.innerHTML = svg;

  // Tooltip 事件
  container.querySelectorAll('.nt-node').forEach(rect => {
    rect.addEventListener('mouseenter', (e) => {
      const nodeId = e.currentTarget.getAttribute('data-node');
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return;
      const d = node.data || {};
      const status = getNodeStatus(node);
      const statusText = status === 'ok' ? '正常' : status === 'error' ? '异常' : status === 'warn' ? '警告' : status === 'unknown' ? '未知' : '静态';
      const portText = d.port ? `<div class="nt-tt-info">端口: ${d.port}</div>` : '';
      const dynText = d.dynamic ? `<div class="nt-tt-info">监控: ${d.dynamic}</div>` : '';

      const tooltip = document.getElementById('nt-tooltip');
      tooltip.innerHTML = `<div class="nt-tt-name">${(d.label || '').replace('\n', ' ')}</div><div class="nt-tt-info">状态: ${statusText}</div>${portText}${dynText}`;
      tooltip.style.display = 'block';
      tooltip.classList.add('visible');
      const cRect = container.getBoundingClientRect();
      tooltip.style.left = (e.clientX - cRect.left + 12) + 'px';
      tooltip.style.top = (e.clientY - cRect.top - 40) + 'px';
    });
    rect.addEventListener('mouseleave', () => {
      const tooltip = document.getElementById('nt-tooltip');
      tooltip.classList.remove('visible');
      tooltip.style.display = 'none';
    });
  });
}

function refreshPage() { loadNetworkTopology(); }

function updateStatusBadge() {
  var badge = document.getElementById('nt-status-badge');
  if (!badge) return;
  var nodeCount = topoConfig?.nodes?.length || 0;
  var edgeCount = topoConfig?.edges?.length || 0;
  badge.className = 'status-badge status-healthy';
  badge.textContent = '已加载 · ' + nodeCount + ' 节点 / ' + edgeCount + ' 连线';
}

loadNetworkTopology();
