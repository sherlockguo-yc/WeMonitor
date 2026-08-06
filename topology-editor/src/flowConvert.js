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

// 正向边使用上下中点（或同一行时左右中点），形成规整的阶梯线。
// 显式指定 handle id，避免 React Flow 12 回退到注册顺序中的 bounds[0]。
function pickHandles(srcBox, tgtBox) {
  const dx = (tgtBox.x + tgtBox.w / 2) - (srcBox.x + srcBox.w / 2);
  const dy = (tgtBox.y + tgtBox.h / 2) - (srcBox.y + srcBox.h / 2);
  const sameRow = Math.abs(dy) < Math.min(srcBox.h, tgtBox.h) * 0.5;
  if (sameRow) {
    return dx >= 0
      ? { sourceHandle: 's-right', targetHandle: 't-left' }
      : { sourceHandle: 's-left', targetHandle: 't-right' };
  }
  return dy >= 0
    ? { sourceHandle: 's-bottom', targetHandle: 't-top' }
    : { sourceHandle: 's-top', targetHandle: 't-bottom' };
}

// 反向边不平移坐标，而是改用同一侧的真实 handle 中点。
// 上下关系的反向链路固定走右侧回路；同行关系走下侧回路。
// 这样两条边互不重叠，箭头也始终落在方框边缘中点。
function pickReturnHandles(srcBox, tgtBox) {
  const dx = (tgtBox.x + tgtBox.w / 2) - (srcBox.x + srcBox.w / 2);
  const dy = (tgtBox.y + tgtBox.h / 2) - (srcBox.y + srcBox.h / 2);
  const sameRow = Math.abs(dy) < Math.min(srcBox.h, tgtBox.h) * 0.5;
  if (sameRow) {
    return dx >= 0
      ? { sourceHandle: 's-bottom', targetHandle: 't-bottom' }
      : { sourceHandle: 's-top', targetHandle: 't-top' };
  }
  return { sourceHandle: 's-right', targetHandle: 't-right' };
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
    // 同对节点的反向边使用另一侧的真实 handle 路由，不再通过平移 SVG 端点制造平行线。
    const reverseIndex = list.findIndex(x => x !== e && x.source === e.target && x.target === e.source);
    const isReturnEdge = reverseIndex >= 0 && reverseIndex < i;
    const type = origType;

    // 兼容策略：旧数据没有 handle 字段时按节点位置补齐。
    // 后出现的反向边走右侧/下侧回路；已存的手动 handle 保持原样。
    let sourceHandle = e.sourceHandle;
    let targetHandle = e.targetHandle;
    if ((!sourceHandle || !targetHandle)) {
      const src = nodeMap[e.source];
      const tgt = nodeMap[e.target];
      if (src && tgt) {
        const picked = (isReturnEdge ? pickReturnHandles : pickHandles)(getAbsBox(src, nodeMap), getAbsBox(tgt, nodeMap));
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
      data: { lineStyle: lineStyle || e.style || 'solid', edgeType: origType, arrow: hasArrow },
      style: (lineStyle || e.style) === 'dashed' ? { strokeDasharray: '6,4' } : undefined,
      markerEnd: hasArrow ? { type: MarkerType.ArrowClosed, width: 16, height: 16 } : undefined,
    };
  });
}
