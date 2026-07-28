import React, { useState, useEffect } from 'react';

const COLORS = [
  { value: 'inherit', label: '自动（按状态）', preview: 'linear-gradient(90deg, #10b981 50%, #a1a1aa 50%)' },
  { value: '#10b981', label: '绿色（在线）', preview: '#10b981' },
  { value: '#f59e0b', label: '橙色（警告）', preview: '#f59e0b' },
  { value: '#ef4444', label: '红色（异常）', preview: '#ef4444' },
  { value: '#6366f1', label: '蓝色', preview: '#6366f1' },
  { value: '#8b5cf6', label: '紫色', preview: '#8b5cf6' },
  { value: '#a1a1aa', label: '灰色（默认）', preview: '#a1a1aa' },
];

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 6,
  border: '1px solid var(--border, #d4d4d8)',
  fontSize: 14, background: 'var(--bg-card, #fff)', color: 'var(--text, #18181b)',
  fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  boxSizing: 'border-box',
};

const btnStyle = (primary) => ({
  padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontWeight: 500,
  fontSize: 14, border: 'none',
  background: primary ? 'var(--accent, #6366f1)' : 'var(--border-light, #f4f4f5)',
  color: primary ? '#fff' : 'var(--text, #18181b)',
});

const SIDE_OPTIONS = [
  { v: 'top',    label: '上方' },
  { v: 'bottom', label: '下方' },
  { v: 'left',   label: '左方' },
  { v: 'right',  label: '右方' },
];

export default function PropertyModal({ type, nodeSnapshot, edgeSnapshot, children: existingChildren, onSave, onClose }) {
  const [label, setLabel] = useState('');
  const [port, setPort] = useState('');
  const [color, setColor] = useState('inherit');
  const [lineStyle, setLineStyle] = useState('solid');
  const [edgeType, setEdgeType] = useState('smoothstep');
  const [arrow, setArrow] = useState(true);
  const [width, setWidth] = useState(140);

  // 子节点管理状态
  const [pendingChildren, setPendingChildren] = useState([]);     // 新增的
  const [removedChildren, setRemovedChildren] = useState(new Set()); // 要删的
  const [showAddChild, setShowAddChild] = useState(false);
  const [newChildSide, setNewChildSide] = useState('top');
  const [newChildLabel, setNewChildLabel] = useState('');

  useEffect(() => {
    if (type === 'edge' && edgeSnapshot) {
      setLabel(edgeSnapshot.label || '');
      setLineStyle(edgeSnapshot.lineStyle || 'solid');
      setEdgeType(edgeSnapshot.edgeType || 'smoothstep');
      setArrow(edgeSnapshot.arrow !== false);
    } else if (type === 'node' && nodeSnapshot) {
      setLabel((nodeSnapshot.label || '').replace(/\n/g, '\\n'));
      setPort(nodeSnapshot.port?.toString() || '');
      setColor(nodeSnapshot.color || 'inherit');
      setWidth(nodeSnapshot.width || 140);
    }
  }, [type, nodeSnapshot, edgeSnapshot]);

  const handleSave = () => {
    if (type === 'edge') {
      onSave({ label, lineStyle, edgeType, arrow });
    } else {
      onSave({
        label: label.replace(/\\n/g, '\n'),
        port: port ? parseInt(port, 10) : null,
        color: color === 'inherit' ? null : color,
        width: parseInt(width, 10) || 140,
        childrenToAdd: pendingChildren,
        childrenToRemove: [...removedChildren],
      });
    }
  };

  const handleAddChild = () => {
    const trimmed = newChildLabel.trim();
    if (!trimmed) return;
    setPendingChildren(prev => [...prev, { label: trimmed, side: newChildSide }]);
    setNewChildLabel('');
    setNewChildSide('top');
    setShowAddChild(false);
  };

  const handleRemoveChild = (childId) => {
    setRemovedChildren(prev => new Set([...prev, childId]));
  };

  // 合并显示列表：现有子节点（排除已删除）+ 待添加
  const displayChildren = [
    ...(existingChildren || []).filter(c => !removedChildren.has(c.id)),
    ...pendingChildren.map((c, i) => ({ id: `pending-${i}`, data: c, _pending: true })),
  ];

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); }
    if (e.key === 'Escape') onClose();
  };

  const overlayStyle = {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.3)', zIndex: 9999,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  const cardStyle = {
    background: 'var(--bg-card, #fff)', borderRadius: 12, padding: 24,
    width: 380, maxHeight: '80vh', overflowY: 'auto',
    boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
    color: 'var(--text, #18181b)',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  };

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 18px', fontSize: 16, fontWeight: 600 }}>
          {type === 'edge' ? '编辑连线' : '编辑节点'}
        </h3>

        {/* 标签 */}
        <label style={labelStyle}>
          标签 {type === 'node' && <span style={hintStyle}>（\\n 换行）</span>}
        </label>
        {type === 'node' ? (
          <textarea
            value={label} onChange={(e) => setLabel(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
            rows={2}
            autoFocus
          />
        ) : (
          <input
            value={label} onChange={(e) => setLabel(e.target.value)}
            onKeyDown={handleKeyDown}
            style={inputStyle}
            autoFocus
          />
        )}

        {type === 'node' && (
          <>
            {/* 端口 */}
            <label style={labelStyle}>端口号</label>
            <input
              type="number" value={port} onChange={(e) => setPort(e.target.value)}
              onKeyDown={handleKeyDown}
              style={inputStyle} placeholder="例: 5174"
            />

            {/* 宽度 */}
            <label style={labelStyle}>节点宽度</label>
            <input
              type="number" value={width} onChange={(e) => setWidth(e.target.value)}
              onKeyDown={handleKeyDown}
              style={inputStyle} min={80} max={500}
            />

            {/* 颜色 */}
            <label style={labelStyle}>边框颜色</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {COLORS.map(c => (
                <button
                  key={c.value}
                  onClick={() => setColor(c.value)}
                  title={c.label}
                  style={{
                    width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
                    border: color === c.value ? '2px solid var(--accent, #6366f1)' : '2px solid transparent',
                    background: c.preview,
                    boxShadow: color === c.value ? '0 0 0 2px rgba(99,102,241,0.2)' : undefined,
                  }}
                />
              ))}
            </div>
          </>
        )}

        {/* 线型开关（仅边） */}
        {type === 'edge' && (
          <>
            <label style={labelStyle}>线条走向</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { v: 'straight', label: '直线' },
                { v: 'smoothstep', label: '阶梯' },
                { v: 'bezier', label: '曲线' },
              ].map(o => (
                <button key={o.v} onClick={() => setEdgeType(o.v)} style={{
                  ...styleToggleSm,
                  background: edgeType === o.v ? 'var(--accent, #6366f1)' : 'var(--border-light, #f4f4f5)',
                  color: edgeType === o.v ? '#fff' : 'var(--text)',
                }}>{o.label}</button>
              ))}
            </div>

            <label style={labelStyle}>实线 / 虚线</label>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setLineStyle('solid')} style={{
                ...styleToggleBtn,
                background: lineStyle === 'solid' ? 'var(--accent, #6366f1)' : 'var(--border-light, #f4f4f5)',
                color: lineStyle === 'solid' ? '#fff' : 'var(--text)',
              }}>──── 实线</button>
              <button onClick={() => setLineStyle('dashed')} style={{
                ...styleToggleBtn,
                background: lineStyle === 'dashed' ? 'var(--accent, #6366f1)' : 'var(--border-light, #f4f4f5)',
                color: lineStyle === 'dashed' ? '#fff' : 'var(--text)',
              }}>- - - 虚线</button>
            </div>

            <label style={labelStyle}>方向箭头</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                onClick={() => setArrow(!arrow)}
                style={{
                  position: 'relative', display: 'inline-block',
                  width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
                  background: arrow ? 'var(--accent, #6366f1)' : 'var(--border, #d4d4d8)',
                  transition: 'background 0.2s',
                }}
              >
                <span style={{
                  position: 'absolute', top: 2,
                  left: arrow ? 20 : 2,
                  width: 18, height: 18, borderRadius: '50%',
                  background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  transition: 'left 0.2s',
                }} />
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>{arrow ? '显示' : '隐藏'}</span>
            </div>
          </>
        )}

        {/* 子节点管理（仅节点） */}
        {type === 'node' && (
          <>
            <div style={{
              marginTop: 20, paddingTop: 16,
              borderTop: '1px solid var(--border, #e4e4e7)',
            }}>
              <label style={{ ...labelStyle, marginTop: 0 }}>子节点</label>
              <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 8px' }}>
                子节点会贴附在主节点外侧，随主节点一起移动
              </p>

              {displayChildren.length === 0 && !showAddChild && (
                <div style={{ fontSize: 13, color: 'var(--text-dim)', padding: '8px 0' }}>
                  暂无子节点
                </div>
              )}

              {displayChildren.map((c, idx) => (
                <div key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px', marginBottom: 4,
                  borderRadius: 6, background: 'var(--border-light, #f4f4f5)',
                  fontSize: 13,
                }}>
                  <span style={{
                    display: 'inline-block', padding: '1px 6px', borderRadius: 4,
                    background: 'var(--accent, #6366f1)', color: '#fff',
                    fontSize: 11, fontWeight: 500, flexShrink: 0,
                  }}>
                    {SIDE_OPTIONS.find(s => s.v === c.data?.side)?.label || c.data?.side || '上方'}
                  </span>
                  <span style={{ flex: 1, fontWeight: 500, color: 'var(--text)' }}>
                    {c.data?.label || c.data?.label_calc || ''}
                    {c._pending && <span style={{ fontSize: 11, color: 'var(--accent)', marginLeft: 4 }}>（新增）</span>}
                  </span>
                  <button onClick={() => handleRemoveChild(c.id)} title="删除子节点" style={{
                    padding: '2px 6px', border: 'none', borderRadius: 4,
                    background: 'transparent', color: 'var(--danger, #ef4444)',
                    cursor: 'pointer', fontSize: 18, lineHeight: 1,
                  }}>×</button>
                </div>
              ))}

              {showAddChild ? (
                <div style={{
                  padding: '10px 12px', borderRadius: 8,
                  background: 'var(--border-light, #f4f4f5)',
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select value={newChildSide} onChange={(e) => setNewChildSide(e.target.value)}
                      style={{ ...inputStyle, width: 80, flexShrink: 0 }}>
                      {SIDE_OPTIONS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                    </select>
                    <input
                      value={newChildLabel} onChange={(e) => setNewChildLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddChild(); if (e.key === 'Escape') setShowAddChild(false); }}
                      style={{ ...inputStyle, flex: 1 }}
                      placeholder="子节点名称"
                      autoFocus
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => setShowAddChild(false)} style={btnStyle(false)}>取消</button>
                    <button onClick={handleAddChild} style={btnStyle(true)}>确定添加</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowAddChild(true)} style={{
                  ...btnStyle(false), width: '100%', marginTop: 4,
                  border: '1px dashed var(--border, #d4d4d8)',
                  color: 'var(--accent, #6366f1)',
                }}>
                  + 添加子节点
                </button>
              )}
            </div>
          </>
        )}

        {/* 按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={btnStyle(false)}>取消</button>
          <button onClick={handleSave} style={btnStyle(true)}>保存</button>
        </div>
      </div>
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, marginTop: 14, color: 'var(--text-dim, #a1a1aa)' };
const hintStyle = { fontWeight: 400, opacity: 0.6, fontSize: 12 };
const styleToggleBtn = { flex: 1, padding: '8px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 500, fontSize: 13, border: 'none' };
const styleToggleSm = { flex: 1, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontWeight: 500, fontSize: 12, border: 'none' };
