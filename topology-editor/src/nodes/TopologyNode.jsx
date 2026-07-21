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
        {data.tags && data.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 3, marginTop: 3, flexWrap: 'wrap' }}>
            {data.tags.map(t => {
              const tagActive = (data.firewallActive != null && t === 'UFW') ? data.firewallActive : null;
              const okBg = 'rgba(16,185,129,0.15)', errBg = 'rgba(239,68,68,0.15)';
              const okBorder = 'rgba(16,185,129,0.3)', errBorder = 'rgba(239,68,68,0.3)';
              return (
                <span key={t} style={{
                  fontSize: 'calc(var(--font-size) * 0.6)',
                  padding: '1px 5px', borderRadius: 3,
                  background: tagActive === true ? okBg : tagActive === false ? errBg : undefined,
                  color: tagActive === true ? '#10b981' : tagActive === false ? '#ef4444' : 'var(--text-dim)',
                  border: '1px solid',
                  borderColor: tagActive === true ? okBorder : tagActive === false ? errBorder : 'var(--border, #e4e4e7)',
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                }}>
                  {tagActive != null && (
                    <span style={{
                      width: 4, height: 4, borderRadius: '50%',
                      background: tagActive ? '#10b981' : '#ef4444',
                      flexShrink: 0,
                    }} />
                  )}
                  {t}
                </span>
              );
            })}
          </div>
        )}
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
