// 流量粒子动画（React Flow 编辑器版）
// 球直接放进粒子覆盖层 SVG（ParticleOverlay 提供）的 flow 坐标系，自动跟随 zoom/pan
// 关键设计：路径按「节点对」定义（hops），运行时通过 findEdgeId(source, target)
// 在拓扑数据中解析实际边 id —— 不依赖边 id 硬编码，用户重画/重连边后动画依然生效

const FLOW_DEFS = [
  { hops: [['internet', 'cf-cdn'], ['cf-cdn', 'cf-tunnel'], ['cf-tunnel', 'n150']], fanout: true, interval: 2500, color: 'var(--flow-public)' },  // 公网入站
  { hops: [['local', 'router'], ['router', 'n150']], fanout: true, interval: 4500, color: 'var(--flow-lan)' },                                      // 内网设备访问
  { hops: [['n150', 'router'], ['router', 'modem'], ['modem', 'isp'], ['isp', 'internet']], fanout: false, interval: 3500, color: 'var(--flow-egress)' }, // N150 出站
];
// 扩散目标（n150 下的服务），同样按节点对解析，缺哪些就只用存在的
const FANOUT_HOPS = [
  ['n150', 'wemonitor'], ['n150', 'webhook'], ['n150', 'wemusic'],
  ['n150', 'wedownload'], ['n150', 'ssh'], ['n150', 'portainer'], ['wedownload', 'aria2'],
];
const BALL_SPEED = 0.12; // px/ms ≈ 120px/s，适中档位

let state = null;

function findEdgePath(edgeId) {
  const g = document.querySelector(`.react-flow__edge[data-id="${edgeId}"]`);
  if (!g) return null;
  return g.querySelector('path.react-flow__edge-path') || g.querySelector('path');
}

// 把节点对序列解析为实际边 id 列表；某一段缺边则截断（流到此为止）
function resolveEdges(hops, findEdgeId) {
  const ids = [];
  for (const [s, t] of hops) {
    const id = findEdgeId(s, t);
    if (!id) break;
    ids.push(id);
  }
  return ids;
}

// 启动动画。layerG 为粒子层 <g>（由 ParticleOverlay 提供，不受 React Flow 管辖）
// getEdgeSourceStatus(edgeId) 返回边源节点健康状态；findEdgeId(source, target) 按节点对解析边
// 返回 true 表示启动成功；边未渲染时返回 false，调用方负责延迟重试
export function startParticles(layerG, getEdgeSourceStatus, findEdgeId) {
  stopParticles();
  if (!layerG) return false;
  const firstIds = resolveEdges(FLOW_DEFS[0].hops, findEdgeId);
  if (firstIds.length === 0 || !findEdgePath(firstIds[0])) return false;

  state = { layer: layerG, balls: [], timers: [], raf: 0, lastTs: 0, geoms: {}, getEdgeSourceStatus, findEdgeId };
  for (const flow of FLOW_DEFS) {
    const ids = resolveEdges(flow.hops, state.findEdgeId);
    if (ids.length === 0) continue; // 起点无对应边则跳过该流
    spawnBall(flow, ids);
    state.timers.push(setInterval(() => spawnBall(flow, resolveEdges(flow.hops, state.findEdgeId)), flow.interval));
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

function spawnBall(flow, edgeIds) {
  const st = state;
  if (!st || document.hidden || !edgeIds || edgeIds.length === 0) return;
  // 状态联动：首边源节点异常则不发球（流量中断语义）
  if (st.getEdgeSourceStatus(edgeIds[0]) === 'error') return;
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  el.setAttribute('r', '4');
  el.setAttribute('fill', flow.color || 'var(--accent)');
  el.setAttribute('opacity', '0.95');
  st.layer.appendChild(el);
  st.balls.push({ edges: edgeIds, fanout: flow.fanout, edgeIdx: 0, dist: 0, el });
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
          // 扩散：随机选一条可用的服务边继续旅程
          const avail = FANOUT_HOPS.map(([s, t]) => st.findEdgeId(s, t)).filter(Boolean);
          const svcId = avail.length ? avail[Math.floor(Math.random() * avail.length)] : null;
          const svcGeom = svcId && getGeom(svcId);
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
