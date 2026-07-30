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

export function toRfEdges(rawEdges) {
  return (rawEdges || []).map((e, i) => {
    const { style: _, lineStyle, edgeType: et, ...rest } = e;
    const hasArrow = e.arrow !== false; // 默认 true，兼容旧数据
    return {
      ...rest,
      id: e.id || `e-${i}`,
      type: et || 'smoothstep',
      animated: false,
      data: { lineStyle: lineStyle || e.style || 'solid', edgeType: et || 'smoothstep', arrow: hasArrow },
      style: (lineStyle || e.style) === 'dashed' ? { strokeDasharray: '6,4' } : undefined,
      markerEnd: hasArrow ? { type: MarkerType.ArrowClosed, width: 16, height: 16 } : undefined,
    };
  });
}
