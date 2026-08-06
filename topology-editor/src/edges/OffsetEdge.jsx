import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Position } from '@xyflow/react';

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function moveTowards(from, to, length) {
  const d = distance(from, to);
  if (d === 0) return from;
  return {
    x: from.x + ((to.x - from.x) / d) * length,
    y: from.y + ((to.y - from.y) / d) * length,
  };
}

function getDirection(position) {
  switch (position) {
    case Position.Top: return { x: 0, y: -1 };
    case Position.Right: return { x: 1, y: 0 };
    case Position.Bottom: return { x: 0, y: 1 };
    case Position.Left: return { x: -1, y: 0 };
    default: return { x: 0, y: 1 };
  }
}

// 为折线路径的拐点加圆角；首尾点从不移动，保证 marker 箭头尖端精确落在 handle 中点。
function getRoundedPath(points, radius = 8) {
  const usable = points.filter((point, index) => index === 0 || distance(points[index - 1], point) > 0.01);
  if (usable.length < 2) return '';

  let path = `M${usable[0].x} ${usable[0].y}`;
  for (let i = 1; i < usable.length - 1; i++) {
    const prev = usable[i - 1];
    const current = usable[i];
    const next = usable[i + 1];
    const cornerRadius = Math.min(radius, distance(prev, current) / 2, distance(current, next) / 2);
    const before = moveTowards(current, prev, cornerRadius);
    const after = moveTowards(current, next, cornerRadius);
    path += `L${before.x} ${before.y}Q${current.x} ${current.y} ${after.x} ${after.y}`;
  }

  const last = usable[usable.length - 1];
  return `${path}L${last.x} ${last.y}`;
}

// 双向边平行路由：仅错开节点外的中段通道，不能偏移 source/target 坐标。
// 偏移端点会让箭头脱离方框边缘，即使 Handle 本身选择正确也会形成“虚接”。
function getParallelPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, offset }) {
  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };
  const sourceDirection = getDirection(sourcePosition);
  const targetDirection = getDirection(targetPosition);
  const verticalHandles = Math.abs(sourceDirection.y) === 1 && Math.abs(targetDirection.y) === 1;
  const primaryDistance = verticalHandles ? Math.abs(targetY - sourceY) : Math.abs(targetX - sourceX);
  const stubLength = Math.min(18, Math.max(6, primaryDistance / 4));
  const sourceStub = {
    x: source.x + sourceDirection.x * stubLength,
    y: source.y + sourceDirection.y * stubLength,
  };
  const targetStub = {
    x: target.x + targetDirection.x * stubLength,
    y: target.y + targetDirection.y * stubLength,
  };

  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const length = Math.hypot(dx, dy) || 1;

  if (verticalHandles) {
    const laneX = (sourceX + targetX) / 2 + (-dy / length) * offset;
    const middleY = (sourceStub.y + targetStub.y) / 2;
    return {
      path: getRoundedPath([
        source,
        sourceStub,
        { x: laneX, y: sourceStub.y },
        { x: laneX, y: targetStub.y },
        targetStub,
        target,
      ]),
      labelX: laneX,
      labelY: middleY,
    };
  }

  const laneY = (sourceY + targetY) / 2 + (dx / length) * offset;
  const middleX = (sourceStub.x + targetStub.x) / 2;
  return {
    path: getRoundedPath([
      source,
      sourceStub,
      { x: sourceStub.x, y: laneY },
      { x: targetStub.x, y: laneY },
      targetStub,
      target,
    ]),
    labelX: middleX,
    labelY: laneY,
  };
}

// 双向边偏移：两条边分配到不同的中段通道，但端点始终保持在节点边的 Handle 中点。
function OffsetEdge({
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  label, data, markerEnd, style,
}) {
  const offset = data?.offset || 0;
  const { path, labelX, labelY } = offset
    ? getParallelPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, offset })
    : (() => {
      const [smoothPath, smoothLabelX, smoothLabelY] = getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        borderRadius: 8,
      });
      return { path: smoothPath, labelX: smoothLabelX, labelY: smoothLabelY };
    })();

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
