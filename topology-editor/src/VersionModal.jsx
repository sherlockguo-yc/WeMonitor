import React, { useState, useEffect } from 'react';
import { fetchVersions, getVersion, restoreVersion } from './api';

const overlayStyle = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.3)', zIndex: 10000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const cardStyle = {
  background: 'var(--bg-card, #fff)', borderRadius: 12, padding: 24,
  width: 600, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
  boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
  color: 'var(--text, #18181b)',
  fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
};

const btnStyle = (primary) => ({
  padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 500,
  fontSize: 13, border: 'none',
  background: primary ? 'var(--accent, #6366f1)' : 'var(--border-light, #f4f4f5)',
  color: primary ? '#fff' : 'var(--text, #18181b)',
});

// ── 迷你 SVG 拓扑预览 ──

const NODE_H = 44;

function computeEndpoints(from, to) {
  const fw = from.data?.width || 140, tw = to.data?.width || 140;
  const fx = from.position.x, fy = from.position.y;
  const tx = to.position.x, ty = to.position.y;
  const fcx = fx + fw / 2, fcy = fy + NODE_H / 2;
  const tcx = tx + tw / 2, tcy = ty + NODE_H / 2;
  const dx = tcx - fcx, dy = tcy - fcy;
  let sx, sy, ex, ey;
  if (Math.abs(dx) > Math.abs(dy) * 5) {
    if (dx > 0) { sx = fx + fw; ex = tx; } else { sx = fx; ex = tx + tw; }
    sy = fcy; ey = tcy;
  } else {
    if (dy > 0) { sy = fy + NODE_H; ey = ty; } else { sy = fy; ey = ty + NODE_H; }
    sx = fcx; ex = tcx;
  }
  return { sx, sy, ex, ey };
}

function smoothstepPath(from, to) {
  const ep = computeEndpoints(from, to);
  const dx = ep.ex - ep.sx, dy = ep.ey - ep.sy;
  const off = (Math.abs(dx) + Math.abs(dy)) * 0.25;
  if (Math.abs(dx) > Math.abs(dy)) {
    return `M${ep.sx},${ep.sy} L${ep.sx + off},${ep.sy} L${ep.ex - off},${ep.ey} L${ep.ex},${ep.ey}`;
  }
  return `M${ep.sx},${ep.sy} L${ep.sx},${ep.sy + off} L${ep.ex},${ep.ey - off} L${ep.ex},${ep.ey}`;
}

function MiniTopologyPreview({ nodes, edges }) {
  if (!nodes || nodes.length === 0) {
    return <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 12, padding: 20 }}>无节点数据</div>;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const w = n.data?.width || 140;
    minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w); maxY = Math.max(maxY, n.position.y + NODE_H);
  }
  const pad = 30;
  const vbX = minX - pad, vbY = minY - pad;
  const vbW = Math.max(maxX - minX + pad * 2, 200);
  const vbH = Math.max(maxY - minY + pad * 2, 150);

  return (
    <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      style={{ width: '100%', height: 240, display: 'block', background: 'var(--bg, #fafafa)' }}
      xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="vp-arrow" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="7" markerHeight="5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="var(--text-dim, #9ca3af)"/>
        </marker>
      </defs>
      {(edges || []).map((e, i) => {
        const from = nodes.find(n => n.id === e.source);
        const to = nodes.find(n => n.id === e.target);
        if (!from || !to) return null;
        const d = smoothstepPath(from, to);
        const dash = e.lineStyle === 'dashed' ? '6,4' : undefined;
        const ep = computeEndpoints(from, to);
        const mx = (ep.sx + ep.ex) / 2, my = (ep.sy + ep.ey) / 2;
        return (
          <g key={`e${i}`}>
            <path d={d} stroke="var(--text-dim, #9ca3af)" strokeWidth="1.5" fill="none"
              strokeDasharray={dash} markerEnd="url(#vp-arrow)" opacity="0.55"/>
            {e.label && (
              <>
                <rect x={mx - e.label.length * 3.5 - 4} y={my - 9} width={e.label.length * 7 + 8} height={14}
                  fill="var(--bg-card, #fff)" rx="3"/>
                <text x={mx} y={my + 1} textAnchor="middle" fontSize="10" fill="var(--text-dim, #9ca3af)">{e.label}</text>
              </>
            )}
          </g>
        );
      })}
      {nodes.map((n, i) => {
        const w = n.data?.width || 140;
        const label = (n.data?.label || n.id).replace(/\n/g, ' ');
        return (
          <g key={`n${i}`}>
            <rect x={n.position.x} y={n.position.y} width={w} height={NODE_H} rx="6"
              fill="var(--bg-card, #fff)" stroke="var(--border, #d4d4d8)" strokeWidth="1.5"/>
            <text x={n.position.x + w / 2} y={n.position.y + NODE_H / 2}
              textAnchor="middle" dominantBaseline="central"
              fontSize="11" fill="var(--text, #18181b)" fontFamily="system-ui, -apple-system, sans-serif">{label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function VersionModal({ onClose, onRestored }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [previewData, setPreviewData] = useState(null);

  useEffect(() => {
    loadVersions();
  }, []);

  async function loadVersions() {
    setLoading(true);
    try {
      const data = await fetchVersions();
      setVersions(data.versions || []);
    } catch (err) {
      setError('加载版本列表失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePreview(versionId) {
    if (previewData?.version_id === versionId) {
      setPreviewData(null);
      return;
    }
    try {
      const data = await getVersion(versionId);
      setPreviewData({ version_id: versionId, ...data });
    } catch (err) {
      setError('预览失败: ' + err.message);
    }
  }

  async function handleRestore(versionId) {
    setRestoring(versionId);
    try {
      await restoreVersion(versionId);
      setConfirmId(null);
      if (onRestored) onRestored();
    } catch (err) {
      setError('恢复失败: ' + err.message);
    } finally {
      setRestoring(null);
    }
  }

  function formatTs(ts) {
    try { return new Date(ts.replace(' ', 'T')).toLocaleString('zh-CN'); }
    catch (_) { return ts; }
  }

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>版本历史</h3>
          <button onClick={onClose} style={{ ...btnStyle(false), fontSize: 18, padding: '2px 8px', lineHeight: 1 }}>×</button>
        </div>

        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 6, background: '#fef2f2', color: 'var(--danger, #ef4444)', fontSize: 13, marginBottom: 12 }}>
            {error}
            <button onClick={() => setError('')} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-dim)', fontSize: 14 }}>加载中...</div>
        ) : versions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-dim)', fontSize: 14 }}>暂无历史版本</div>
        ) : (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {versions.map(v => (
              <div key={v.version_id}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 8px', borderRadius: 8,
                  background: previewData?.version_id === v.version_id ? 'var(--border-light, #f4f4f5)' : 'transparent',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{formatTs(v.timestamp)}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                      {v.node_count} 节点 · {v.edge_count} 连线
                    </div>
                  </div>
                  <button onClick={() => handlePreview(v.version_id)} style={btnStyle(false)}>
                    {previewData?.version_id === v.version_id ? '收起' : '预览'}
                  </button>
                  {confirmId === v.version_id ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => handleRestore(v.version_id)} disabled={restoring === v.version_id}
                        style={{ ...btnStyle(true), background: 'var(--danger, #ef4444)' }}>
                        {restoring === v.version_id ? '恢复中...' : '确认恢复'}
                      </button>
                      <button onClick={() => setConfirmId(null)} style={btnStyle(false)}>取消</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmId(v.version_id)} style={btnStyle(true)}>
                      恢复
                    </button>
                  )}
                </div>

                {/* 预览面板 — 迷你 SVG 拓扑图 */}
                {previewData?.version_id === v.version_id && (
                  <div style={{
                    margin: '0 0 8px', borderRadius: 8, overflow: 'hidden',
                    background: 'var(--bg, #f9fafb)', border: '1px solid var(--border, #e4e4e7)',
                  }}>
                    <div style={{
                      padding: '6px 12px', fontSize: 12, color: 'var(--text-dim)',
                      borderBottom: '1px solid var(--border, #e4e4e7)',
                      display: 'flex', gap: 16,
                    }}>
                      <span><strong>{previewData.nodes?.length || 0}</strong> 节点</span>
                      <span><strong>{previewData.edges?.length || 0}</strong> 连线</span>
                    </div>
                    <MiniTopologyPreview nodes={previewData.nodes} edges={previewData.edges} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
