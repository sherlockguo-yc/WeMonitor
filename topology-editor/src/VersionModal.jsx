import React, { useState, useEffect } from 'react';
import { fetchVersions, getVersion, restoreVersion } from './api';

const overlayStyle = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.3)', zIndex: 10000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const cardStyle = {
  background: 'var(--bg-card, #fff)', borderRadius: 12, padding: 24,
  width: 520, maxHeight: '70vh', display: 'flex', flexDirection: 'column',
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

                {/* 预览面板 */}
                {previewData?.version_id === v.version_id && (
                  <div style={{
                    margin: '0 0 8px', padding: 12, borderRadius: 8,
                    background: '#f9fafb', border: '1px solid var(--border, #e4e4e7)',
                    fontSize: 12, maxHeight: 200, overflowY: 'auto',
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>节点 ({previewData.nodes?.length || 0})</div>
                    {previewData.nodes?.slice(0, 10).map((n, i) => (
                      <div key={i} style={{ marginBottom: 2, color: 'var(--text-dim)' }}>
                        <span style={{ fontWeight: 500, color: 'var(--text)' }}>{n.id}</span>
                        : {n.data?.label?.replace(/\n/g, ' ')} {n.data?.port ? `(:${n.data.port})` : ''}
                      </div>
                    ))}
                    {previewData.nodes?.length > 10 && (
                      <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>... 还有 {previewData.nodes.length - 10} 个节点</div>
                    )}
                    <div style={{ fontWeight: 600, margin: '8px 0 6px' }}>连线 ({previewData.edges?.length || 0})</div>
                    {previewData.edges?.slice(0, 10).map((e, i) => (
                      <div key={i} style={{ marginBottom: 2, color: 'var(--text-dim)' }}>
                        <span style={{ fontWeight: 500, color: 'var(--text)' }}>{e.source}</span>
                        → {e.target} {e.label ? `(${e.label})` : ''}
                        <span style={{ opacity: 0.5 }}> [{e.lineStyle || 'solid'}]</span>
                      </div>
                    ))}
                    {previewData.edges?.length > 10 && (
                      <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>... 还有 {previewData.edges.length - 10} 条连线</div>
                    )}
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
