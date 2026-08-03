/* ===================================================
   WeMonitor — 网络拓扑图（动态版，从配置读取）
   =================================================== */

let topoStatus = { physical: null, firewall: null, tunnel: null, health: [] };
let topoConfig = null;

async function loadNetworkTopology() {
  stopParticles();
  const container = document.getElementById('nt-diagram');
  if (container) container.innerHTML = '<div class="nt-loading">加载网络拓扑...</div>';

  try {
    const [confRes, ptRes, fwRes, tunnelRes, healthRes] = await Promise.allSettled([
      api('/topology-config'),
      api('/physical-topology'),
      api('/firewall/status'),
      api('/tunnel/status'),
      api('/health'),
    ]);

    if (confRes.status !== 'fulfilled' || !confRes.value) {
      if (container) container.innerHTML = '<div class="nt-loading">加载拓扑配置失败</div>';
      return;
    }

    topoConfig = confRes.value;
    topoStatus.physical = ptRes.status === 'fulfilled' ? ptRes.value : null;
    topoStatus.firewall = fwRes.status === 'fulfilled' ? fwRes.value : null;
    topoStatus.tunnel = tunnelRes.status === 'fulfilled' ? tunnelRes.value : null;
    topoStatus.health = healthRes.status === 'fulfilled' ? healthRes.value : [];

    updateStatusBadge();
    // 无容器时只更新状态徽章（/network 页由编辑器渲染，只读视图不挂载）
    if (!container) return;
    renderTopology(container);
  } catch (err) {
    if (container) container.innerHTML = '<div class="nt-loading">加载失败: ' + err.message + '</div>';
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
        const nameMap = { 0: 'WeMusic', 1: 'WeDownload', 2: 'Webhook', 3: 'Portainer', 4: 'aria2' };
        const svc = topoStatus.health.find(h => h.name === nameMap[d.healthIdx]);
        if (!svc) return 'unknown';
        return svc.status === 'healthy' ? 'ok' : 'error';
      }
      return 'unknown';
  }
  return 'static';
}

// ── 连线端点计算 ──

// 节点绝对坐标（子节点 position 是相对父节点的）
function absPos(node, nodes) {
  if (!node.parentId) return node.position;
  const parent = nodes.find(n => n.id === node.parentId);
  if (!parent) return node.position;
  const pp = absPos(parent, nodes);
  return { x: pp.x + node.position.x, y: pp.y + node.position.y };
}

function computeEdgeEndpoints(from, to, edge, edges) {
  const fw = from.data?.width || 140;
  const fh = 44;
  const tw = to.data?.width || 140;
  const th = 44;
  const fx = from._abs.x, fy = from._abs.y;
  const tx = to._abs.x, ty = to._abs.y;
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

  // 双向边：同对节点存在反向边时，沿垂直方向偏移形成平行双车道
  if (edge && edges && edges.some(e => e !== edge && e.source === edge.target && e.target === edge.source)) {
    const pdx = ex - sx, pdy = ey - sy;
    const plen = Math.hypot(pdx, pdy) || 1;
    const off = 10;
    sx += (-pdy / plen) * off; sy += (pdx / plen) * off;
    ex += (-pdy / plen) * off; ey += (pdx / plen) * off;
  }
  return { sx, sy, ex, ey };
}

// ── 渲染 SVG ──

function renderTopology(container) {
  if (!topoConfig) return;
  const { nodes, edges } = topoConfig;

  // 预计算所有节点绝对坐标（子节点 = 父节点 + 相对坐标）
  for (const n of nodes) n._abs = absPos(n, nodes);

  // 计算画布范围（空节点时显示默认画布）
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const w = n.data?.width || 140;
    minX = Math.min(minX, n._abs.x);
    minY = Math.min(minY, n._abs.y);
    maxX = Math.max(maxX, n._abs.x + w);
    maxY = Math.max(maxY, n._abs.y + 44);
  }
  const pad = 40;
  const W = nodes.length > 0 ? maxX - minX + pad * 2 : 400;
  const H = nodes.length > 0 ? Math.max(maxY - minY + pad * 2, 400) : 300;
  const ox = nodes.length > 0 ? minX - pad : 0;
  const oy = nodes.length > 0 ? minY - pad : 0;

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

    const ep = computeEdgeEndpoints(from, to, edge, edges);
    let color = 'var(--text-dim)', marker = 'url(#arr-dim)', dash = '';

    // 边颜色
    const fromStatus = getNodeStatus(from);
    if (fromStatus === 'ok') { color = 'var(--success)'; marker = 'url(#arr-green)'; }
    if (fromStatus === 'error') { color = 'var(--danger)'; marker = 'url(#arr-danger)'; }

    // 虚线样式
    const lStyle = edge.lineStyle || 'solid';
    if (lStyle === 'dashed') dash = 'stroke-dasharray="6,4"';

    // 共享属性
    const arrow = edge.arrow !== false; // 默认 true，兼容旧数据
    const markerEnd = arrow ? `marker-end="${marker}"` : '';
    const stroke = `stroke="${color}" stroke-width="2.5" fill="none" stroke-linejoin="round" stroke-linecap="round" ${dash} ${markerEnd}`;
    const eType = edge.edgeType || 'smoothstep';

    if (eType === 'smoothstep') {
      // React Flow 同款 smoothstep：xDist/yDist = (|dx|+|dy|)*0.25
      // x 方向距离大时用水平分段，否则用垂直分段
      const dx = ep.ex - ep.sx, dy = ep.ey - ep.sy;
      const offset = (Math.abs(dx) + Math.abs(dy)) * 0.25;
      let d;
      if (Math.abs(dx) > Math.abs(dy)) {
        // 水平：M(sx,sy) L(sx+off,sy) L(ex-off,ey) L(ex,ey)
        d = `M${ep.sx},${ep.sy} L${ep.sx + offset},${ep.sy} L${ep.ex - offset},${ep.ey} L${ep.ex},${ep.ey}`;
      } else {
        // 垂直：M(sx,sy) L(sx,sy+off) L(ex,ey-off) L(ex,ey)
        d = `M${ep.sx},${ep.sy} L${ep.sx},${ep.sy + offset} L${ep.ex},${ep.ey - offset} L${ep.ex},${ep.ey}`;
      }
      svg += `<path d="${d}" ${stroke} data-edge="${edge.id}"/>`;
    } else if (eType === 'bezier') {
      // 贝塞尔曲线（匹配 React Flow v12 default bezier）
      // 选取 |dx|/|dy| 中较大值的一半作为控制点偏移
      const dx = ep.ex - ep.sx, dy = ep.ey - ep.sy;
      const c = Math.max(Math.abs(dx), Math.abs(dy)) * 0.4;
      let d;
      if (Math.abs(dx) >= Math.abs(dy)) {
        // 主要水平：控制点水平偏移
        d = `M${ep.sx},${ep.sy} C${ep.sx + c},${ep.sy} ${ep.ex - c},${ep.ey} ${ep.ex},${ep.ey}`;
      } else {
        // 主要垂直：控制点垂直偏移
        d = `M${ep.sx},${ep.sy} C${ep.sx},${ep.sy + c} ${ep.ex},${ep.ey - c} ${ep.ex},${ep.ey}`;
      }
      svg += `<path d="${d}" ${stroke} data-edge="${edge.id}"/>`;
    } else {
      // 直线（统一用 path 输出，便于粒子动画 getPointAtLength）
      const angle = Math.atan2(ep.ey - ep.sy, ep.ex - ep.sx);
      const ex2 = ep.ex - 4 * Math.cos(angle);
      const ey2 = ep.ey - 4 * Math.sin(angle);
      svg += `<path d="M${ep.sx},${ep.sy} L${ex2},${ey2}" ${stroke} data-edge="${edge.id}"/>`;
    }

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
    const x = node._abs.x, y = node._abs.y;
    const status = getNodeStatus(node);

    // 手动颜色优先于状态色
    const manualColor = d.color;
    const bc = manualColor || (status === 'ok' ? 'var(--success)' : status === 'error' ? 'var(--danger)' : status === 'warn' ? 'var(--warning)' : 'var(--border)');
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

  // 粒子层（最上层）
  svg += '<g id="nt-particles"></g>';
  svg += '</svg>';

  // Tooltip
  svg += '<div id="nt-tooltip" class="nt-tooltip" style="display:none;"></div>';

  container.innerHTML = svg;

  // 收集边几何，启动粒子动画
  const edgeGeoms = {};
  container.querySelectorAll('path[data-edge]').forEach(p => {
    edgeGeoms[p.getAttribute('data-edge')] = { pathEl: p, length: p.getTotalLength() };
  });
  initParticles(edgeGeoms);

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

// ── 流量粒子动画系统 ──
// 三条流：公网入站（到 n150 后扩散到服务）、内网访问、N150 出站
// 剧本边 id 与 topology.json 中的边 id 对应，default 与运行时拓扑通用

const FLOW_DEFS = [
  { edges: ['e-pub1', 'e-pub2', 'e-pub3'], fanout: true, interval: 2500 },     // 公网入站
  { edges: ['e-lan4r', 'e-rn'], fanout: true, interval: 4500 },                // 内网设备访问
  { edges: ['e-out1', 'e-out2', 'e-out3', 'e-out4'], fanout: false, interval: 3500 }, // N150 出站
];
const FANOUT_EDGES = ['e-svc1', 'e-svc2', 'e-svc3', 'e-svc4', 'e-svc5', 'e-svc6', 'e-svc7'];
const BALL_SPEED = 0.12; // px/ms ≈ 120px/s，适中档位

let particleState = null;

function initParticles(edgeGeoms) {
  stopParticles();
  const layer = document.getElementById('nt-particles');
  if (!layer) return;
  particleState = { layer, geoms: edgeGeoms, balls: [], timers: [], raf: 0, lastTs: 0 };
  for (const flow of FLOW_DEFS) {
    if (!flow.edges.every(id => edgeGeoms[id])) continue; // 边不全则跳过该流
    spawnBall(flow); // 立即先发一球，避免页面打开空等
    particleState.timers.push(setInterval(() => spawnBall(flow), flow.interval));
  }
  particleState.raf = requestAnimationFrame(tickParticles);
  document.addEventListener('visibilitychange', onParticleVisChange);
}

function spawnBall(flow) {
  const st = particleState;
  if (!st || document.hidden) return;
  // 状态联动：首边源节点异常则不发球（流量中断语义）
  const firstEdge = (topoConfig.edges || []).find(e => e.id === flow.edges[0]);
  const fromNode = firstEdge && (topoConfig.nodes || []).find(n => n.id === firstEdge.source);
  if (fromNode && getNodeStatus(fromNode) === 'error') return;
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  el.setAttribute('r', '4');
  el.setAttribute('fill', 'var(--accent)');
  el.setAttribute('opacity', '0.95');
  st.layer.appendChild(el);
  st.balls.push({ edges: flow.edges, fanout: flow.fanout, edgeIdx: 0, dist: 0, el });
}

function tickParticles(ts) {
  const st = particleState;
  if (!st) return;
  const dt = st.lastTs ? Math.min(ts - st.lastTs, 100) : 16;
  st.lastTs = ts;
  for (let i = st.balls.length - 1; i >= 0; i--) {
    const b = st.balls[i];
    let geom = st.geoms[b.edges[b.edgeIdx]];
    if (!geom) { removeBall(i); continue; }
    b.dist += BALL_SPEED * dt;
    while (geom && b.dist >= geom.length) {
      b.dist -= geom.length;
      b.edgeIdx++;
      if (b.edgeIdx >= b.edges.length) {
        if (b.fanout) {
          // 扩散：随机选一条服务边继续旅程
          const svcId = FANOUT_EDGES[Math.floor(Math.random() * FANOUT_EDGES.length)];
          if (st.geoms[svcId]) {
            b.edges = [svcId]; b.fanout = false; b.edgeIdx = 0;
            geom = st.geoms[svcId];
            continue;
          }
        }
        removeBall(i);
        geom = null;
      } else {
        geom = st.geoms[b.edges[b.edgeIdx]];
        if (!geom) { removeBall(i); }
      }
    }
    if (!geom) continue;
    const pt = geom.pathEl.getPointAtLength(b.dist);
    b.el.setAttribute('cx', pt.x);
    b.el.setAttribute('cy', pt.y);
  }
  st.raf = requestAnimationFrame(tickParticles);
}

function removeBall(i) {
  const st = particleState;
  if (!st || !st.balls[i]) return;
  st.balls[i].el.remove();
  st.balls.splice(i, 1);
}

function onParticleVisChange() {
  const st = particleState;
  if (!st) return;
  if (document.hidden) {
    cancelAnimationFrame(st.raf);
    st.lastTs = 0;
  } else {
    st.raf = requestAnimationFrame(tickParticles);
  }
}

function stopParticles() {
  if (!particleState) return;
  particleState.timers.forEach(clearInterval);
  cancelAnimationFrame(particleState.raf);
  document.removeEventListener('visibilitychange', onParticleVisChange);
  particleState = null;
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
