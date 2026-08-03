// 流量粒子动画（React Flow 编辑器版）
// 球直接放进 React Flow 边 SVG 的 flow 坐标系，自动跟随 zoom/pan，无需坐标变换
// 剧本边 id 与 topology.json 对应，与只读视图（network-topology.js）保持一致

const FLOW_DEFS = [
  { edges: ['e-pub1', 'e-pub2', 'e-pub3'], fanout: true, interval: 2500, color: 'var(--flow-public)' },          // 公网入站
  { edges: ['e-lan4r', 'e-rn'], fanout: true, interval: 4500, color: 'var(--flow-lan)' },                        // 内网设备访问
  { edges: ['e-out1', 'e-out2', 'e-out3', 'e-out4'], fanout: false, interval: 3500, color: 'var(--flow-egress)' }, // N150 出站
];
const FANOUT_EDGES = ['e-svc1', 'e-svc2', 'e-svc3', 'e-svc4', 'e-svc5', 'e-svc6', 'e-svc7'];
const BALL_SPEED = 0.12; // px/ms ≈ 120px/s，适中档位

let state = null;

function findEdgePath(edgeId) {
  const g = document.querySelector(`.react-flow__edge[data-id="${edgeId}"]`);
  if (!g) return null;
  return g.querySelector('path.react-flow__edge-path') || g.querySelector('path');
}

// 启动动画。layerG 为粒子层 <g> 元素（由 ParticleOverlay 组件提供，不受 React Flow 管辖）
// getEdgeSourceStatus(edgeId) 返回边源节点的健康状态（ok/error/...）
// 返回 true 表示启动成功；边未渲染时返回 false，调用方负责延迟重试
export function startParticles(layerG, getEdgeSourceStatus) {
  stopParticles();
  const firstPath = findEdgePath(FLOW_DEFS[0].edges[0]);
  if (!layerG || !firstPath) return false;

  state = { layer: layerG, balls: [], timers: [], raf: 0, lastTs: 0, geoms: {}, getEdgeSourceStatus };
  for (const flow of FLOW_DEFS) {
    if (!flow.edges.every(id => findEdgePath(id))) continue; // 边不全则跳过该流
    spawnBall(flow); // 立即先发一球，避免页面打开空等
    state.timers.push(setInterval(() => spawnBall(flow), flow.interval));
  }
  state.raf = requestAnimationFrame(tick);
  document.addEventListener('visibilitychange', onVis);
  return true;
}

export function stopParticles() {
  if (!state) return;
  state.timers.forEach(clearInterval);
  cancelAnimationFrame(state.raf);
  document.removeEventListener('visibilitychange', onVis);
  state = null; // layer 由 React 组件自行卸载，此处不 remove
}

function getGeom(edgeId) {
  const st = state;
  let g = st.geoms[edgeId];
  const now = performance.now();
  if (!g || !g.pathEl.isConnected) {
    const pathEl = findEdgePath(edgeId);
    if (!pathEl) return null;
    g = st.geoms[edgeId] = { pathEl, length: pathEl.getTotalLength(), measured: now };
  } else if (now - g.measured > 2000) {
    // 定期重测长度（节点移动/重连会改变 path）
    g.length = g.pathEl.getTotalLength();
    g.measured = now;
  }
  return g;
}

function spawnBall(flow) {
  const st = state;
  if (!st || document.hidden) return;
  // 状态联动：首边源节点异常则不发球（流量中断语义）
  if (st.getEdgeSourceStatus(flow.edges[0]) === 'error') return;
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  el.setAttribute('r', '4');
  el.setAttribute('fill', flow.color || 'var(--accent)');
  el.setAttribute('opacity', '0.95');
  st.layer.appendChild(el);
  st.balls.push({ edges: flow.edges, fanout: flow.fanout, edgeIdx: 0, dist: 0, el, color: flow.color });
}

function tick(ts) {
  const st = state;
  if (!st) return;
  const dt = st.lastTs ? Math.min(ts - st.lastTs, 100) : 16;
  st.lastTs = ts;
  for (let i = st.balls.length - 1; i >= 0; i--) {
    const b = st.balls[i];
    let geom = getGeom(b.edges[b.edgeIdx]);
    if (!geom) { removeBall(i); continue; }
    b.dist += BALL_SPEED * dt;
    while (geom && b.dist >= geom.length) {
      b.dist -= geom.length;
      b.edgeIdx++;
      if (b.edgeIdx >= b.edges.length) {
        if (b.fanout) {
          // 扩散：随机选一条服务边继续旅程
          const svcId = FANOUT_EDGES[Math.floor(Math.random() * FANOUT_EDGES.length)];
          const svcGeom = getGeom(svcId);
          if (svcGeom) {
            b.edges = [svcId]; b.fanout = false; b.edgeIdx = 0;
            geom = svcGeom;
            continue;
          }
        }
        removeBall(i);
        geom = null;
      } else {
        geom = getGeom(b.edges[b.edgeIdx]);
        if (!geom) { removeBall(i); }
      }
    }
    if (!geom) continue;
    const pt = geom.pathEl.getPointAtLength(b.dist);
    b.el.setAttribute('cx', pt.x);
    b.el.setAttribute('cy', pt.y);
  }
  st.raf = requestAnimationFrame(tick);
}

function removeBall(i) {
  const st = state;
  if (!st || !st.balls[i]) return;
  st.balls[i].el.remove();
  st.balls.splice(i, 1);
}

function onVis() {
  const st = state;
  if (!st) return;
  if (document.hidden) {
    cancelAnimationFrame(st.raf);
    st.lastTs = 0;
  } else {
    st.raf = requestAnimationFrame(tick);
  }
}
