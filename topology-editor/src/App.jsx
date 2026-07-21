import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Panel,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import TopologyNode from './nodes/TopologyNode';
import PropertyModal from './PropertyModal';
import { fetchTopology, saveTopology, fetchStatus } from './api';

const nodeTypes = { topology: TopologyNode };

// 节点类型模板
const NODE_TEMPLATES = [
  { type: 'internet',  label: 'Internet',     width: 120, icon: '🌐', color: '#6366f1' },
  { type: 'host',      label: '服务器',        width: 140, icon: '🖥️', color: '#10b981' },
  { type: 'router',    label: '路由器',        width: 130, icon: '📡', color: '#f59e0b' },
  { type: 'firewall',  label: '防火墙',        width: 130, icon: '🛡️', color: '#ef4444' },
  { type: 'tunnel',    label: 'Tunnel',       width: 140, icon: '🔗', color: '#8b5cf6' },
  { type: 'cdn',       label: 'CDN',          width: 120, icon: '☁️', color: '#ec4899' },
  { type: 'service',   label: '服务',          width: 120, icon: '⚙️', color: '#06b6d4' },
  { type: 'isp',       label: 'ISP',          width: 100, icon: '🏢', color: '#84cc16' },
  { type: 'device',    label: '设备',          width: 120, icon: '📱', color: '#a1a1aa' },
  { type: 'modem',     label: '光猫',          width: 100, icon: '🔌', color: '#14b8a6' },
];

let idCounter = 0;
function uniqueId() { return `node-${Date.now()}-${idCounter++}`; }

// 从实时状态计算节点颜色（只在状态变化时更新）
function computeStatuses(topologyNodes, statusData) {
  const { physical, firewall, tunnel, health } = statusData;
  let anyChanged = false;
  const updated = topologyNodes.map(node => {
    const d = node.data || {};
    if (!d.dynamic && (!d.tags || d.tags.length === 0)) return node;

    let status = d.status || 'unknown';
    if (d.dynamic) {
      switch (d.dynamic) {
        case 'modem': if (physical?.modem) status = physical.modem.online ? 'ok' : 'error'; break;
        case 'router': if (physical?.router) status = physical.router.online ? 'ok' : 'error'; break;
        case 'n150': if (physical?.n150) status = physical.n150.online ? 'ok' : 'error'; break;
        case 'firewall': if (firewall) status = firewall.status === 'active' ? 'ok' : 'error'; break;
        case 'tunnel': if (tunnel) status = tunnel.active ? 'ok' : 'error'; break;
        case 'health':
          if (d.healthIdx === -1) status = 'ok';
          else if (Array.isArray(health)) {
            const nameMap = { 0: 'WeMusic', 1: 'WeDownload' };
            const svc = health.find(h => h.name === nameMap[d.healthIdx]);
            if (svc) status = svc.status === 'healthy' ? 'ok' : 'error';
          }
          break;
      }
    }

    // N150 节点注入 UFW 防火墙状态（供 tags 中 UFW chip 显示）
    let firewallActive = d.firewallActive;
    if (d.dynamic === 'n150' && firewall) {
      firewallActive = firewall.status === 'active';
    }

    const nodeChanged = d.status !== status || !d.isDynamic || d.firewallActive !== firewallActive;
    if (nodeChanged) anyChanged = true;
    return nodeChanged ? { ...node, data: { ...d, status, isDynamic: true, firewallActive } } : node;
  });
  return anyChanged ? updated : null;
}

// 错误边界
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <h2 style={{ color: 'var(--danger)' }}>编辑器加载失败</h2>
          <pre style={{ fontSize: 13, color: 'var(--text-dim)', whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
          </pre>
          <button onClick={() => this.setState({ error: null })} style={btnStyle}>重试</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// 左侧节点面板
function NodePalette() {
  const onDragStart = (e, tpl) => {
    e.dataTransfer.setData('application/reactflow', JSON.stringify(tpl));
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div style={{
      width: 120, background: 'var(--bg-card, #fff)',
      borderRight: '1px solid var(--border, #e4e4e7)',
      padding: 8, overflowY: 'auto',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', padding: '0 4px 4px', textAlign: 'center' }}>
        拖入画布
      </div>
      {NODE_TEMPLATES.map(tpl => (
        <div
          key={tpl.type}
          draggable
          onDragStart={(e) => onDragStart(e, tpl)}
          style={{
            padding: '6px 10px', borderRadius: 6, cursor: 'grab',
            border: `1.5px solid ${tpl.color}22`,
            background: `${tpl.color}0d`,
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 13, fontWeight: 500,
            color: 'var(--text)',
          }}
        >
          <span style={{ fontSize: 14 }}>{tpl.icon}</span>
          <span>{tpl.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const reactFlowWrapper = useRef(null);
  const [rfInstance, setRfInstance] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [statusData, setStatusData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [readOnly, setReadOnly] = useState(true);
  const [tooltip, setTooltip] = useState(null);
  const [editor, setEditor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [topo, st] = await Promise.all([fetchTopology(), fetchStatus()]);
      setStatusData(st);
      const withStatus = computeStatuses(topo.nodes, st);
      if (withStatus) setNodes(withStatus);
      setEdges(topo.edges.map((e, i) => {
        const { style: _, lineStyle, edgeType: et, ...rest } = e;
        return {
          ...rest,
          id: e.id || `e-${i}`,
          type: et || 'smoothstep',
          animated: false,
          data: { lineStyle: lineStyle || e.style || 'solid', edgeType: et || 'smoothstep' },
          style: (lineStyle || e.style) === 'dashed' ? { strokeDasharray: '6,4' } : undefined,
        };
      }));
      setMsg('');
    } catch (err) {
      setMsg('加载失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  useEffect(() => { load(); }, [load]);

  // 只读模式同步到节点（隐藏 Handle）
  useEffect(() => {
    setNodes(nds => nds.map(n => n.data._readOnly === readOnly ? n : { ...n, data: { ...n.data, _readOnly: readOnly } }));
  }, [readOnly, setNodes]);

  useEffect(() => {
    const timer = setInterval(async () => {
      try { const st = await fetchStatus(); setStatusData(st); setNodes(nds => computeStatuses(nds, st) || nds); }
      catch (_) {}
    }, 15000);
    return () => clearInterval(timer);
  }, [setNodes]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const topo = {
        nodes: nodes.map(n => ({
          id: n.id, type: n.type, position: n.position,
          data: { label: n.data.label, port: n.data.port, dynamic: n.data.dynamic, healthIdx: n.data.healthIdx, width: n.data.width, color: n.data.color, tags: n.data.tags },
        })),
        edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, label: e.label || '', lineStyle: e.data?.lineStyle || 'solid', edgeType: e.type === 'default' ? 'straight' : (e.type || 'smoothstep') })),
      };
      await saveTopology(topo);
      setMsg('已保存 → 刷新概览页查看');
      setTimeout(() => setMsg(''), 2500);
    } catch (err) { setMsg('保存失败: ' + err.message); }
    finally { setSaving(false); }
  }, [nodes, edges]);

  const onConnect = useCallback((params) => {
    setEdges(eds => addEdge({ ...params, type: 'smoothstep', label: '', data: { lineStyle: 'solid', edgeType: 'smoothstep' } }, eds));
  }, [setEdges]);

  // 双击节点 → 打开属性编辑器（捕获快照避免闭包陈旧引用）
  const onNodeDoubleClick = useCallback((e, node) => {
    if (readOnly) return;
    setEditor({
      type: 'node',
      nodeId: node.id,
      nodeSnapshot: { label: node.data.label, port: node.data.port, color: node.data.color, width: node.data.width, tags: node.data.tags },
    });
  }, [readOnly]);

  // 双击边 → 打开属性编辑器
  const onEdgeDoubleClick = useCallback((e, edge) => {
    if (readOnly) return;
    setEditor({
      type: 'edge',
      edgeId: edge.id,
      edgeSnapshot: { label: edge.label || '', lineStyle: edge.data?.lineStyle || 'solid', edgeType: edge.type === 'default' ? 'straight' : (edge.type || 'smoothstep') },
    });
  }, [readOnly]);

  // 节点悬停 tooltip
  const onNodeMouseEnter = useCallback((e, node) => {
    if (!node.data?.isDynamic) return;
    const d = node.data;
    const st = d.status === 'ok' ? '正常' : d.status === 'error' ? '异常' : d.status === 'warn' ? '警告' : '未知';
    setTooltip({ text: `${(d.label || '').replace('\\n', ' ')} · ${st}${d.port ? ' · :' + d.port : ''}`, x: e.clientX, y: e.clientY });
  }, []);
  const onNodeMouseMove = useCallback((e) => {
    if (tooltip) setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null);
  }, [tooltip]);
  const onNodeMouseLeave = useCallback(() => { setTooltip(null); }, []);

  // 属性编辑器保存（使用 captured nodeId/edgeId 操作最新 state）
  const handleEditorSave = useCallback((data) => {
    if (editor.type === 'node') {
      const id = editor.nodeId;
      setNodes(nds => nds.map(n => {
        if (n.id !== id) return n;
        return { ...n, data: { ...n.data, label: data.label, port: data.port, color: data.color || undefined, width: data.width, tags: data.tags } };
      }));
    } else {
      const id = editor.edgeId;
      setEdges(eds => eds.map(ed => {
        if (ed.id !== id) return ed;
        return { ...ed, label: data.label, type: data.edgeType, data: { ...ed.data, lineStyle: data.lineStyle, edgeType: data.edgeType }, style: data.lineStyle === 'dashed' ? { strokeDasharray: '6,4' } : undefined };
      }));
    }
    setEditor(null);
  }, [editor, setNodes, setEdges]);

  // 从面板拖入节点
  const onDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/reactflow');
    if (!raw) return;
    const tpl = JSON.parse(raw);
    const pos = rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const newNode = {
      id: uniqueId(),
      type: 'topology',
      position: { x: pos.x - (tpl.width / 2), y: pos.y - 22 },
      data: { label: tpl.label, width: tpl.width, port: null, dynamic: null, status: 'static', isDynamic: false },
    };
    setNodes(nds => nds.concat(newNode));
  }, [rfInstance, setNodes]);

  return (
    <ErrorBoundary>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* 工具栏 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '8px 16px', background: 'var(--bg-card, #fff)',
          borderBottom: '1px solid var(--border, #e4e4e7)', fontSize: 14,
        }}>
          <span style={{ fontWeight: 600 }}>网络拓扑</span>
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            {readOnly ? '悬停节点查看状态 · 点击「编辑」修改' : '拖入节点 · 从下方圆点拖线 · 双击改属性 · Delete 删除'}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={load} style={btnStyle}>刷新</button>
          <button onClick={() => setReadOnly(!readOnly)} style={{
            ...btnStyle, background: readOnly ? 'var(--accent, #6366f1)' : undefined, color: readOnly ? '#fff' : undefined,
          }}>
            {readOnly ? '编辑' : '退出编辑'}
          </button>
          {!readOnly && (
            <button onClick={save} disabled={saving} style={{
              ...btnStyle, background: saving ? '#a1a1aa' : 'var(--success, #10b981)', color: '#fff',
            }}>
              {saving ? '保存中...' : '保存'}
            </button>
          )}
          {msg && <span style={{ color: msg.includes('失败') ? 'var(--danger)' : 'var(--success)', fontSize: 13 }}>{msg}</span>}
        </div>

        {/* 主区域：面板 + 画布 */}
        <div style={{ flex: 1, display: 'flex' }} ref={reactFlowWrapper}>
          {!readOnly && <NodePalette />}
          <div style={{ flex: 1 }}>
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={readOnly ? undefined : onNodesChange}
                onEdgesChange={readOnly ? undefined : onEdgesChange}
                onConnect={readOnly ? undefined : onConnect}
                onNodeDoubleClick={onNodeDoubleClick}
                onEdgeDoubleClick={readOnly ? undefined : onEdgeDoubleClick}
                onNodeMouseEnter={onNodeMouseEnter}
                onNodeMouseMove={onNodeMouseMove}
                onNodeMouseLeave={onNodeMouseLeave}
                onInit={setRfInstance}
                onDragOver={readOnly ? undefined : onDragOver}
                onDrop={readOnly ? undefined : onDrop}
                nodeTypes={nodeTypes}
                fitView
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                elementsSelectable={!readOnly}
                deleteKeyCode={readOnly ? null : 'Delete'}
                multiSelectionKeyCode={readOnly ? null : 'Shift'}
                snapToGrid
                snapGrid={[10, 10]}
                panOnScroll={readOnly}
              >
                {!readOnly && <Controls />}
                <Background gap={20} size={1} color="var(--border-light, #e4e4e7)" />
                {!readOnly && <MiniMap nodeStrokeWidth={2} pannable zoomable />}
              </ReactFlow>
            </ReactFlowProvider>
          </div>
        </div>

        {/* 悬停 tooltip */}
        {tooltip && (
          <div style={{
            position: 'fixed', top: tooltip.y - 36, left: tooltip.x + 12,
            background: 'var(--bg-card, #fff)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '4px 10px', fontSize: 13, zIndex: 10000,
            pointerEvents: 'none', whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            color: 'var(--text)',
          }}>
            {tooltip.text}
          </div>
        )}
      </div>

      {/* 属性编辑弹窗 */}
      {editor && (
        <PropertyModal
          type={editor.type}
          nodeSnapshot={editor.nodeSnapshot}
          edgeSnapshot={editor.edgeSnapshot}
          onSave={handleEditorSave}
          onClose={() => setEditor(null)}
        />
      )}
    </ErrorBoundary>
  );
}

const btnStyle = {
  padding: '4px 14px', borderRadius: 6,
  border: '1px solid var(--border, #d4d4d8)',
  background: 'var(--bg-card, #fff)', color: 'var(--text, #18181b)',
  fontSize: 13, cursor: 'pointer', fontWeight: 500,
};
