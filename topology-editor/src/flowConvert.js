import { MarkerType } from '@xyflow/react';

// 存储格式（topology.json）→ React Flow 节点/边 的转换。
// 主画布（App.jsx）与版本历史预览（VersionModal.jsx）共用本模块，
// 保证两处渲染结果完全一致，禁止再各自实现一套。

export function toRfNodes(rawNodes) {
  return (rawNodes || []).map(n => ({
    ...n,
    type: n.type || 'topology',
    parentId: n.parentId || undefined, // React Flow 原生处理子节点相对坐标
    data: { ...n.data, _parentId: n.parentId || null },
  }));
}

// 解析节点绝对位置（沿 parentId 链上溯累加）和估算尺寸。
// 父节点的真实 handle 测量 React Flow 内部会做（基于 DOM），
// 此处只用于离线计算 handle 方向，不需要像素级精确。
function getAbsBox(node, nodeMap) {
  const w = node.data?.width || 140;
  const h = Math.max(44, ((node.data?.label || '').split('\n').length || 1) * 20 + 12);
  let pos = { x: node.position.x, y: node.position.y };
  let cur = node;
  const seen = new Set([node.id]);
  while (cur.parentId && nodeMap[cur.parentId] && !seen.has(cur.parentId)) {
    cur = nodeMap[cur.parentId];
    seen.add(cur.id);
    pos = { x: pos.x + cur.position.x, y: pos.y + cur.position.y };
  }
  return { x: pos.x, y: pos.y, w, h };
}

// 根据源/目标中心点相对位置，选出最佳 sourceHandle / targetHandle。
// 规则：取 dx/dy 绝对值较大者为主方向，让线从该方向的中点出发/到达，
// 避免 React Flow 12 在 edge 未指定 sourceHandle 时回退到「同类型 handle 数组的第一个」
// 导致所有线都连到 s-bottom → t-top。
function pickHandles(srcBox, tgtBox) {
  const dx = (tgtBox.x + tgtBox.w / 2) - (srcBox.x + srcBox.w / 2);
  const dy = (tgtBox.y + tgtBox.h / 2) - (srcBox.y + srcBox.h / 2);

  let sourceHandle, targetHandle;
  if (Math.abs(dx) > Math.abs(dy)) {
    // 水平主导
    sourceHandle = dx > 0 ? 's-right' : 's-left';
    targetHandle = dx > 0 ? 't-left'  : 't-right';
  } else {
    // 垂直主导
    sourceHandle = dy > 0 ? 's-bottom' : 's-top';
    targetHandle = dy > 0 ? 't-top'    : 't-bottom';
  }
  return { sourceHandle, targetHandle };
}

export function toRfEdges(rawEdges, rawNodes) {
  const list = rawEdges || [];
  // 构建 nodeMap 用于解析子节点绝对位置（pickHandles 需要源/目标 box）
  const nodeMap = {};
  (rawNodes || []).forEach(n => { nodeMap[n.id] = n; });

  return list.map((e, i) => {
    const { style: _, lineStyle, edgeType: et, ...rest } = e;
    const hasArrow = e.arrow !== false; // 默认 true，兼容旧数据
    const origType = et || 'smoothstep';
    // 同对节点存在反向边 → 转自定义偏移边形成平行双车道（仅渲染期类型，data.edgeType 保留原始值供保存）
    const hasReverse = list.some(x => x !== e && x.source === e.target && x.target === e.source);
    const type = hasReverse ? 'offset' : origType;

    // 兼容策略：若 edge 未指定 handle（topology.json 中早期数据没有此字段），
    // 按当前源/目标节点位置自动选 handle，保证线接在方框边的中点上。
    // 已存的 handle（用户手动 reconnect 过的）保持原样。
    let sourceHandle = e.sourceHandle;
    let targetHandle = e.targetHandle;
    if ((!sourceHandle || !targetHandle)) {
      const src = nodeMap[e.source];
      const tgt = nodeMap[e.target];
      if (src && tgt) {
        const picked = pickHandles(getAbsBox(src, nodeMap), getAbsBox(tgt, nodeMap));
        if (!sourceHandle) sourceHandle = picked.sourceHandle;
        if (!targetHandle) targetHandle = picked.targetHandle;
      }
    }

    return {
      ...rest,
      id: e.id || `e-${i}`,
      type,
      sourceHandle: sourceHandle || undefined,
      targetHandle: targetHandle || undefined,
      animated: false,
      data: { lineStyle: lineStyle || e.style || 'solid', edgeType: origType, arrow: hasArrow, offset: hasReverse ? 12 : 0 },
      style: (lineStyle || e.style) === 'dashed' ? { strokeDasharray: '6,4' } : undefined,
      markerEnd: hasArrow ? { type: MarkerType.ArrowClosed, width: 16, height: 16 } : undefined,
    };
  });
}
