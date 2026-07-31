import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react';

// 双向边偏移：同对节点存在反向边时，沿垂直方向偏移形成平行双车道。
// offset 由 flowConvert.toRfEdges 检测双向后注入 data.offset（A→B 与 B→A 法线相反，天然分居两侧）
function OffsetEdge({
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  label, data, markerEnd, style,
}) {
  const offset = data?.offset || 0;
  const dx = targetX - sourceX, dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const ox = (-dy / len) * offset, oy = (dx / len) * offset;

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: sourceX + ox, sourceY: sourceY + oy,
    targetX: targetX + ox, targetY: targetY + oy,
    sourcePosition, targetPosition,
    borderRadius: 8,
  });

  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              fontSize: 10,
              color: 'var(--text-dim, #71717a)',
              pointerEvents: 'none',
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default React.memo(OffsetEdge);
