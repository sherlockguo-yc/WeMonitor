import React from 'react';
import { Handle, Position } from '@xyflow/react';

// 节点状态色
function statusColor(status) {
  if (status === 'ok') return 'var(--success, #10b981)';
  if (status === 'error') return 'var(--danger, #ef4444)';
  if (status === 'warn') return 'var(--warning, #f59e0b)';
  return 'var(--text-dim, #a1a1aa)';
}

export default function TopologyNode({ data, selected }) {
  const { label, port, status, isDynamic } = data;
  const lines = (label || '').split('\n');
  const color = statusColor(status);
  const borderColor = selected ? 'var(--accent, #6366f1)' : color;
  const bgColor = status === 'error' ? 'rgba(239,68,68,0.08)'
    : status === 'warn' ? 'rgba(245,158,11,0.08)'
    : 'var(--bg-card, #fff)';

  const w = data.width || 140;
  const h = 44;

  return (
    <div
      style={{
        width: w,
        minHeight: h,
        padding: '6px 12px',
        borderRadius: 8,
        border: `2px solid ${borderColor}`,
        background: bgColor,
        fontSize: 'calc(var(--font-size, 14px) * 0.84)',
        fontWeight: 500,
        color: 'var(--text, #18181b)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        position: 'relative',
        boxShadow: selected ? '0 0 0 2px rgba(99,102,241,0.3)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
      <Handle type="target" position={Position.Left} style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Right} style={{ visibility: 'hidden' }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {l}
          </div>
        ))}
      </div>

      {/* 端口标签 */}
      {port && (
        <span
          style={{
            fontSize: 'calc(var(--font-size, 14px) * 0.7)',
            color: 'var(--text-dim, #a1a1aa)',
            fontFamily: 'monospace',
            fontWeight: 500,
            flexShrink: 0,
            marginLeft: 4,
          }}
        >
          :{port}
        </span>
      )}

      {/* 状态圆点 */}
      {isDynamic && (
        <div
          style={{
            width: 10, height: 10, borderRadius: '50%',
            background: color,
            flexShrink: 0,
          }}
        />
      )}
    </div>
  );
}
