import React from 'react';
import { Handle, Position } from '@xyflow/react';

function statusColor(status) {
  if (status === 'ok') return 'var(--success, #10b981)';
  if (status === 'error') return 'var(--danger, #ef4444)';
  if (status === 'warn') return 'var(--warning, #f59e0b)';
  return 'var(--text-dim, #a1a1aa)';
}

const handleStyle = {
  width: 8, height: 8, background: 'var(--accent, #6366f1)',
  border: '1.5px solid var(--bg-card, #fff)',
};

function TopologyNode({ data, selected }) {
  const { label, port, status, isDynamic, color: manualColor, _readOnly } = data;
  const readOnly = !!_readOnly;
  const lines = (label || '').split('\n');
  const autoColor = statusColor(status);
  const color = manualColor || autoColor;
  const borderColor = selected ? 'var(--accent, #6366f1)' : color;
  const bgColor = status === 'error' ? 'rgba(239,68,68,0.08)'
    : status === 'warn' ? 'rgba(245,158,11,0.08)'
    : 'var(--bg-card, #fff)';

  const w = data.width || 140;

  return (
    <div
      style={{
        width: w, minHeight: 44,
        padding: '6px 12px', borderRadius: 8,
        border: `2px solid ${borderColor}`, background: bgColor,
        fontSize: 'calc(var(--font-size, 14px) * 0.84)',
        fontWeight: 500, color: 'var(--text, #18181b)',
        display: 'flex', alignItems: 'center', gap: 8,
        position: 'relative', cursor: readOnly ? 'default' : 'pointer',
        boxShadow: selected ? '0 0 0 2px rgba(99,102,241,0.3)' : undefined,
      }}
      title={readOnly ? undefined : '双击修改标签 / 从下方圆点拖线连接'}
    >
      {!readOnly && <Handle type="target" position={Position.Top} style={handleStyle} />}
      {!readOnly && <Handle type="source" position={Position.Bottom} style={handleStyle} />}

      <div style={{ flex: 1, minWidth: 0 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {l}
          </div>
        ))}
      </div>

      {port && (
        <span style={{
          fontSize: 'calc(var(--font-size, 14px) * 0.7)',
          color: 'var(--text-dim, #a1a1aa)',
          fontFamily: 'monospace', fontWeight: 500,
          flexShrink: 0, marginLeft: 4,
        }}>:{port}</span>
      )}

      {isDynamic && (
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
      )}
    </div>
  );
}

export default React.memo(TopologyNode);
