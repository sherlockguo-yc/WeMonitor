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
  MarkerType,
  SelectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import TopologyNode from './nodes/TopologyNode';
import OffsetEdge from './edges/OffsetEdge';
import PropertyModal from './PropertyModal';
import VersionModal from './VersionModal';
import { fetchTopology, saveTopology, fetchStatus } from './api';
import { toRfNodes, toRfEdges } from './flowConvert';
import ParticleOverlay from './ParticleOverlay';

const nodeTypes = { topology: TopologyNode };
const edgeTypes = { offset: OffsetEdge };

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

// 计算子节点贴附在父节点外侧的相对位置
function calcChildPos(parent, side, order, totalOnSide) {
  const cw = 80, ch = 36, gap = 6, spacing = 4;
  const pw = parent.data?.width || 140;
  const ph = Math.max(44, ((parent.data?.label || '').split('\n').length || 1) * 20 + 12);

  switch (side) {
    case 'top': {
      const tw = totalOnSide * cw + Math.max(0, totalOnSide - 1) * spacing;
      return { x: Math.round((pw - tw) / 2 + order * (cw + spacing)), y: -(ch + gap) };
    }
    case 'bottom': {
      const tw = totalOnSide * cw + Math.max(0, totalOnSide - 1) * spacing;
      return { x: Math.round((pw - tw) / 2 + order * (cw + spacing)), y: ph + gap };
    }
    case 'left': {
      const th = totalOnSide * ch + Math.max(0, totalOnSide - 1) * spacing;
      return { x: -(cw + gap), y: Math.round((ph - th) / 2 + order * (ch + spacing)) };
    }
    case 'right': {
      const th = totalOnSide * ch + Math.max(0, totalOnSide - 1) * spacing;
      return { x: pw + gap, y: Math.round((ph - th) / 2 + order * (ch + spacing)) };
    }
    default: return { x: 0, y: -(ch + gap) };
  }
}

// 从实时状态计算节点颜色（只在状态变化时更新）
function computeStatuses(topologyNodes, statusData) {
  const { physical, firewall, tunnel, health } = statusData;
  let changed = false;
  const updated = topologyNodes.map(node => {
    const d = node.data || {};
    if (!d.dynamic) return node;
    let status = 'unknown';
    switch (d.dynamic) {
      case 'modem': if (physical?.modem) status = physical.modem.online ? 'ok' : 'error'; break;
      case 'router': if (physical?.router) status = physical.router.online ? 'ok' : 'error'; break;
      case 'n150': if (physical?.n150) status = physical.n150.online ? 'ok' : 'error'; break;
      case 'firewall': if (firewall) status = firewall.status === 'active' ? 'ok' : 'error'; break;
      case 'tunnel': if (tunnel) status = tunnel.active ? 'ok' : 'error'; break;
      case 'health':
        if (d.healthIdx === -1) status = 'ok';
        else if (Array.isArray(health)) {
          const nameMap = { 0: 'WeMusic', 1: 'WeDownload', 2: 'Webhook', 3: 'Portainer', 4: 'aria2' };
          const svc = health.find(h => h.name === nameMap[d.healthIdx]);
          if (svc) status = svc.status === 'healthy' ? 'ok' : 'error';
        }
        break;
    }
    if (d.status !== status || !d.isDynamic) changed = true;
    return changed ? { ...node, data: { ...d, status, isDynamic: true } } : node;
  });
  return changed ? updated : null; // 无变化返回 null
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
  const readOnlyRef = useRef(readOnly);
  useEffect(() => { readOnlyRef.current = readOnly; }, [readOnly]);
  const [tooltip, setTooltip] = useState(null);
  const [editor, setEditor] = useState(null);
  const [showVersions, setShowVersions] = useState(false);
  const [dirty, setDirty] = useState(false);
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  const systemUpdateRef = useRef(false);
  const edgesRef = useRef(edges);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [topo, st] = await Promise.all([fetchTopology(), fetchStatus()]);
      setStatusData(st);
      // 恢复 parentId（父-子关系），转换逻辑与版本预览共用（flowConvert.js）
      const nodesWithParent = toRfNodes(topo.nodes);
      const withStatus = computeStatuses(nodesWithParent, st);
      if (withStatus) setNodes(withStatus);
      const rfEdges = toRfEdges(topo.edges, topo.nodes);
      setEdges(rfEdges);
      // 同步只读标记：toRfNodes 不带 _readOnly，load 重置节点数据后 useEffect 不会重跑，
      // 这里显式同步一次，确保只读模式下 handle 不渲染
      setNodes(nds => nds.map(n => n.data._readOnly === readOnlyRef.current ? n : { ...n, data: { ...n.data, _readOnly: readOnlyRef.current } }));
      setMsg('');
      setDirty(false);
      // 更新页面卡片上的状态徽章（原由已下线的只读视图脚本负责）
      const badge = document.getElementById('nt-status-badge');
      if (badge) {
        badge.className = 'status-badge status-healthy';
        badge.textContent = `已加载 · ${topo.nodes.length} 节点 / ${rfEdges.length} 连线`;
      }
    } catch (err) {
      setMsg('加载失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  useEffect(() => { load(); }, [load]);

  // 只读模式同步到节点（隐藏 Handle）— 标记为系统更新，不触发 dirty
  useEffect(() => {
    systemUpdateRef.current = true;
    setNodes(nds => nds.map(n => n.data._readOnly === readOnly ? n : { ...n, data: { ...n.data, _readOnly: readOnly } }));
    systemUpdateRef.current = false;
  }, [readOnly, setNodes]);

  // 边源节点状态查询（供粒子系统做异常链路断流）
  const getEdgeSourceStatus = useCallback((edgeId) => {
    const e = edgesRef.current.find(x => x.id === edgeId);
    if (!e) return 'static';
    const n = nodesRef.current.find(x => x.id === e.source);
    return n?.data?.status || 'static';
  }, []);

  // 按节点对解析边 id（供粒子系统定位路径；不依赖边 id，用户重连后依然生效）
  const findEdgeId = useCallback((source, target) => {
    const e = edgesRef.current.find(x => x.source === source && x.target === target);
    return e ? e.id : null;
  }, []);

  useEffect(() => {
    const timer = setInterval(async () => {
      try { const st = await fetchStatus(); setStatusData(st); setNodes(nds => computeStatuses(nds, st) || nds); }
      catch (_) {}
    }, 15000);
    return () => clearInterval(timer);
  }, [setNodes]);

  // Shift 键追踪（拖拽框选）
  useEffect(() => {
    const down = (e) => { if (e.key === 'Shift') setShiftHeld(true); };
    const up = (e) => { if (e.key === 'Shift') setShiftHeld(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // 快捷键：Ctrl+Z/Y/S/D
  useEffect(() => {
    if (readOnly) return;
    const handler = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      if (mod && e.key === 's') { e.preventDefault(); save(); }
      if (mod && e.key === 'd') { e.preventDefault(); duplicateSelected(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Undo / Redo ──────────────────────────────────
  const snapshot = useCallback(() => {
    undoStack.current.push({ nodes: nodesRef.current, edges: edgesRef.current });
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
  }, []);

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    redoStack.current.push({ nodes: nodesRef.current, edges: edgesRef.current });
    const prev = undoStack.current.pop();
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setDirty(true);
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    undoStack.current.push({ nodes: nodesRef.current, edges: edgesRef.current });
    const next = redoStack.current.pop();
    setNodes(next.nodes);
    setEdges(next.edges);
    setDirty(true);
  }, [setNodes, setEdges]);

  // ─── 复制选中节点 ──────────────────────────────────
  const duplicateSelected = useCallback(() => {
    const selected = nodesRef.current.filter(n => n.selected && !n.parentId);
    if (selected.length === 0) return;
    snapshot();
    const newNodes = selected.map(n => ({
      id: uniqueId(), type: 'topology',
      position: { x: n.position.x + 30, y: n.position.y + 30 },
      data: { ...n.data, status: 'static', isDynamic: false },
    }));
    setNodes(nds => [...nds.map(n => ({ ...n, selected: false })), ...newNodes]);
    setDirty(true);
  }, [setNodes]);

  // ─── 右键菜单 ─────────────────────────────────────
  const onNodeContextMenu = useCallback((e, node) => {
    e.preventDefault();
    if (readOnly) return;
    // 如果未选中则选中该节点
    if (!node.selected) {
      setNodes(nds => nds.map(n => ({ ...n, selected: n.id === node.id })));
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, type: 'node', targetId: node.id });
  }, [readOnly, setNodes]);

  const onEdgeContextMenu = useCallback((e, edge) => {
    e.preventDefault();
    if (readOnly) return;
    if (!edge.selected) {
      setEdges(eds => eds.map(ed => ({ ...ed, selected: ed.id === edge.id })));
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, type: 'edge', targetId: edge.id });
  }, [readOnly, setEdges]);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  // ─── 边重连 ───────────────────────────────────────
  const onReconnect = useCallback((oldEdge, newConnection) => {
    snapshot();
    setEdges(eds => eds.map(e => {
      if (e.id !== oldEdge.id) return e;
      return { ...e, source: newConnection.source, target: newConnection.target, sourceHandle: newConnection.sourceHandle || undefined, targetHandle: newConnection.targetHandle || undefined };
    }));
    setDirty(true);
  }, [setEdges]);

  // ─── 拖拽前快照 ───────────────────────────────────
  const onNodeDragStart = useCallback(() => { snapshot(); }, []);

  // ─── 自动布局 ─────────────────────────────────────
  const autoLayout = useCallback(() => {
    snapshot();
    const topNodes = nodesRef.current.filter(n => !n.parentId);
    const childMap = {};
    nodesRef.current.filter(n => n.parentId).forEach(c => {
      if (!childMap[c.parentId]) childMap[c.parentId] = [];
      childMap[c.parentId].push(c);
    });
    const inDegree = {};
    topNodes.forEach(n => inDegree[n.id] = 0);
    edgesRef.current.forEach(e => {
      if (inDegree[e.target] !== undefined) inDegree[e.target]++;
    });
    const roots = topNodes.filter(n => inDegree[n.id] === 0);
    const layers = new Map();
    const queue = roots.map(n => ({ id: n.id, layer: 0 }));
    while (queue.length > 0) {
      const { id, layer } = queue.shift();
      if (layers.has(id) && layers.get(id) >= layer) continue;
      layers.set(id, layer);
      edgesRef.current.filter(e => e.source === id).forEach(e => {
        if (inDegree[e.target] !== undefined) queue.push({ id: e.target, layer: layer + 1 });
      });
    }
    // 未覆盖的节点放到最后一层
    topNodes.forEach(n => { if (!layers.has(n.id)) layers.set(n.id, 0); });

    const layerGroups = {};
    layers.forEach((layer, id) => {
      if (!layerGroups[layer]) layerGroups[layer] = [];
      layerGroups[layer].push(id);
    });

    const layerHeight = 120;
    const nodeWidth = 170;
    const newNodes = nodesRef.current.map(n => {
      if (n.parentId) return n; // 子节点不动
      const layer = layers.get(n.id) || 0;
      const group = layerGroups[layer] || [];
      const idx = group.indexOf(n.id);
      return { ...n, position: { x: idx * (nodeWidth + 40), y: layer * layerHeight + 40 } };
    });
    setNodes(newNodes);
    setDirty(true);
  }, [setNodes]);

  // ─── 导出 JSON ────────────────────────────────────
  const exportJSON = useCallback(() => {
    const topo = {
      nodes: nodesRef.current.map(n => ({
        id: n.id, type: n.type, position: n.position, parentId: n.parentId,
        data: { label: n.data.label, port: n.data.port, dynamic: n.data.dynamic, healthIdx: n.data.healthIdx, width: n.data.width, color: n.data.color, side: n.data.side, order: n.data.order },
      })),
      edges: edgesRef.current.map(e => ({
        id: e.id, source: e.source, target: e.target,
        sourceHandle: e.sourceHandle || undefined, targetHandle: e.targetHandle || undefined,
        label: e.label || '',
        lineStyle: e.data?.lineStyle || 'solid', edgeType: e.type || 'smoothstep', arrow: e.data?.arrow !== false,
      })),
    };
    const blob = new Blob([JSON.stringify(topo, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `topology-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const topo = {
        nodes: nodes.map(n => ({
          id: n.id, type: n.type, position: n.position,
          parentId: n.parentId || undefined,
          data: { label: n.data.label, port: n.data.port, dynamic: n.data.dynamic, healthIdx: n.data.healthIdx, width: n.data.width, color: n.data.color, side: n.data.side, order: n.data.order },
        })),
        edges: edges.map(e => ({
          id: e.id, source: e.source, target: e.target,
          sourceHandle: e.sourceHandle || undefined, targetHandle: e.targetHandle || undefined,
          label: e.label || '', lineStyle: e.data?.lineStyle || 'solid', edgeType: e.type === 'default' ? 'straight' : (e.data?.edgeType || e.type || 'smoothstep'), arrow: e.data?.arrow !== false,
        })),
      };
      await saveTopology(topo);
      setMsg('已保存 → 刷新概览页查看');
      setDirty(false);
      setTimeout(() => setMsg(''), 2500);
    } catch (err) { setMsg('保存失败: ' + err.message); }
    finally { setSaving(false); }
  }, [nodes, edges]);

  const onConnect = useCallback((params) => {
    snapshot();
    setEdges(eds => addEdge({ ...params, type: 'smoothstep', label: '', data: { lineStyle: 'solid', edgeType: 'smoothstep', arrow: true }, markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } }, eds));
    setDirty(true);
  }, [setEdges]);

  const handleNodesChange = useCallback((changes) => {
    // 级联删除：父节点被删时，子节点也一并删除
    const removedIds = changes.filter(c => c.type === 'remove').map(c => c.id);
    if (removedIds.length > 0) {
      const removeSet = new Set(removedIds);
      const queue = [...removedIds];
      while (queue.length > 0) {
        const pid = queue.shift();
        nodesRef.current.filter(n => n.parentId === pid).forEach(n => {
          if (!removeSet.has(n.id)) {
            removeSet.add(n.id);
            queue.push(n.id);
            changes = [...changes, { type: 'remove', id: n.id }];
          }
        });
      }
    }
    onNodesChange(changes);
    if (!systemUpdateRef.current) setDirty(true);
  }, [onNodesChange]);

  const handleEdgesChange = useCallback((changes) => {
    onEdgesChange(changes);
    if (!systemUpdateRef.current) setDirty(true);
  }, [onEdgesChange]);

  // 按 Delete 键删除选中的边
  const onEdgesDelete = useCallback((deletedEdges) => {
    setDirty(true);
  }, []);

  // 按 Delete 键删除选中的节点
  const onNodesDelete = useCallback((deletedNodes) => {
    setDirty(true);
  }, []);

  // 删除选中的节点和边（工具栏按钮用）
  const deleteSelected = useCallback(() => {
    snapshot();
    setNodes(nds => nds.filter(n => !n.selected));
    setEdges(eds => eds.filter(e => !e.selected));
    setDirty(true);
  }, [setNodes, setEdges]);

  const selectedCount = nodes.filter(n => n.selected).length + edges.filter(e => e.selected).length;

  // 双击节点 → 打开属性编辑器（捕获子节点信息）
  const onNodeDoubleClick = useCallback((e, node) => {
    if (readOnly) return;
    const children = nodesRef.current
      .filter(n => n.parentId === node.id)
      .map(n => ({ id: n.id, data: n.data }));
    setEditor({
      type: 'node',
      nodeId: node.id,
      nodeSnapshot: { label: node.data.label, port: node.data.port, color: node.data.color, width: node.data.width },
      children,
    });
  }, [readOnly]);

  // 双击边 → 打开属性编辑器
  const onEdgeDoubleClick = useCallback((e, edge) => {
    if (readOnly) return;
    setEditor({
      type: 'edge',
      edgeId: edge.id,
      edgeSnapshot: { label: edge.label || '', lineStyle: edge.data?.lineStyle || 'solid', edgeType: edge.type === 'default' ? 'straight' : (edge.type || 'smoothstep'), arrow: edge.data?.arrow !== false },
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

  // 属性编辑器保存
  const handleEditorSave = useCallback((data) => {
    snapshot();
    if (editor.type === 'node') {
      const id = editor.nodeId;
      // 更新节点属性
      setNodes(nds => nds.map(n => {
        if (n.id !== id) return n;
        return { ...n, data: { ...n.data, label: data.label, port: data.port, color: data.color || undefined, width: data.width } };
      }));

      // 删除子节点
      if (data.childrenToRemove?.length) {
        const removeSet = new Set(data.childrenToRemove);
        setNodes(nds => nds.filter(n => !removeSet.has(n.id)));
      }

      // 添加子节点
      if (data.childrenToAdd?.length) {
        setNodes(nds => {
          const parent = nds.find(n => n.id === id);
          if (!parent) return nds;

          // 按侧边分组，计算每个侧边的 order
          const counts = {};
          nds.filter(n => n.parentId === id && !data.childrenToRemove?.includes(n.id))
            .forEach(n => { const s = n.data.side || 'top'; counts[s] = (counts[s] || 0) + 1; });
          // 计入本次新增
          data.childrenToAdd.forEach(c => { counts[c.side] = (counts[c.side] || 0) + 1; });

          const newNodes = [];
          const sideOrders = {};
          data.childrenToAdd.forEach(c => {
            if (!sideOrders[c.side]) sideOrders[c.side] = 0;
            const existing = nds.filter(n => n.parentId === id && n.data.side === c.side && !data.childrenToRemove?.includes(n.id)).length;
            const order = existing + sideOrders[c.side]++;
            const pos = calcChildPos(parent, c.side, order, counts[c.side]);
            newNodes.push({
              id: uniqueId(), type: 'topology', parentId: id, position: pos,
              data: {
                label: c.label, width: 80, port: null,
                dynamic: null, status: 'static', isDynamic: false,
                side: c.side, order,
              },
            });
          });
          return [...nds, ...newNodes];
        });
      }
    } else {
      const id = editor.edgeId;
      setEdges(eds => eds.map(ed => {
        if (ed.id !== id) return ed;
        const hasArrow = data.arrow !== false;
        return {
          ...ed, label: data.label, type: data.edgeType,
          data: { ...ed.data, lineStyle: data.lineStyle, edgeType: data.edgeType, arrow: hasArrow },
          style: data.lineStyle === 'dashed' ? { strokeDasharray: '6,4' } : undefined,
          markerEnd: hasArrow ? { type: MarkerType.ArrowClosed, width: 16, height: 16 } : undefined,
        };
      }));
    }
    setEditor(null);
    setDirty(true);
  }, [editor, setNodes, setEdges]);

  // 从面板拖入节点
  const onDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/reactflow');
    if (!raw) return;
    snapshot();
    const tpl = JSON.parse(raw);
    const pos = rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const newNode = {
      id: uniqueId(),
      type: 'topology',
      position: { x: pos.x - (tpl.width / 2), y: pos.y - 22 },
      data: { label: tpl.label, width: tpl.width, port: null, dynamic: null, status: 'static', isDynamic: false },
    };
    setNodes(nds => nds.concat(newNode));
    setDirty(true);
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
            {readOnly ? '悬停节点查看状态 · 点击「编辑」修改' : 'Shift+拖拽框选 · Ctrl+Z/Y 撤销重做 · Ctrl+S 保存 · 右键更多操作'}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={load} style={btnStyle}>刷新</button>
          <button onClick={() => setShowVersions(true)} style={btnStyle}>版本历史</button>
          {!readOnly && (
            <>
              <button onClick={autoLayout} style={btnStyle}>自动布局</button>
              <button onClick={exportJSON} style={btnStyle}>导出</button>
            </>
          )}
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
          {!readOnly && selectedCount > 0 && (
            <button onClick={deleteSelected} style={{
              ...btnStyle, background: 'var(--danger, #ef4444)', color: '#fff',
            }}>
              删除选中 ({selectedCount})
            </button>
          )}
          {dirty && !readOnly && <span style={{ color: '#f59e0b', fontSize: 13, fontWeight: 500 }}>⚠ 有未保存的修改</span>}
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
                onNodesChange={readOnly ? undefined : handleNodesChange}
                onEdgesChange={readOnly ? undefined : handleEdgesChange}
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
                edgeTypes={edgeTypes}
                fitView
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                elementsSelectable={!readOnly}
                deleteKeyCode={readOnly ? null : 'Delete'}
                multiSelectionKeyCode={readOnly ? null : 'Shift'}
                onNodesDelete={readOnly ? undefined : onNodesDelete}
                onEdgesDelete={readOnly ? undefined : onEdgesDelete}
                onNodeDragStart={readOnly ? undefined : onNodeDragStart}
                onReconnect={readOnly ? undefined : onReconnect}
                edgesReconnectable={!readOnly}
                selectionOnDrag={!readOnly && shiftHeld}
                panOnDrag={!shiftHeld}
                selectionMode={SelectionMode.Partial}
                onNodeContextMenu={onNodeContextMenu}
                onEdgeContextMenu={readOnly ? undefined : onEdgeContextMenu}
                onClick={closeCtxMenu}
                snapToGrid
                snapGrid={[10, 10]}
                panOnScroll={readOnly}
              >
                {!readOnly && <Controls />}
                <Background gap={20} size={1} color="var(--border-light, #e4e4e7)" />
                {!readOnly && <MiniMap nodeStrokeWidth={2} pannable zoomable />}
                {readOnly && !loading && nodes.length > 0 && (
                  <ParticleOverlay getEdgeSourceStatus={getEdgeSourceStatus} findEdgeId={findEdgeId} />
                )}
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

      {/* 右键菜单 */}
      {ctxMenu && (
        <div
          style={{
            position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 10001,
            background: 'var(--bg-card, #fff)', borderRadius: 8,
            border: '1px solid var(--border, #e4e4e7)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            padding: '4px 0', minWidth: 120,
          }}
          onMouseLeave={closeCtxMenu}
        >
          {ctxMenu.type === 'node' ? (
            <>
              <div style={ctxItem} onClick={() => { duplicateSelected(); closeCtxMenu(); }}>复制</div>
              <div style={{ ...ctxItem, color: 'var(--danger, #ef4444)' }}
                onClick={() => { deleteSelected(); closeCtxMenu(); }}>删除</div>
              <div style={ctxItem} onClick={() => {
                const node = nodesRef.current.find(n => n.id === ctxMenu.targetId);
                if (node) onNodeDoubleClick(null, node);
                closeCtxMenu();
              }}>编辑属性</div>
            </>
          ) : (
            <>
              <div style={{ ...ctxItem, color: 'var(--danger, #ef4444)' }}
                onClick={() => { deleteSelected(); closeCtxMenu(); }}>删除</div>
              <div style={ctxItem} onClick={() => {
                const edge = edgesRef.current.find(e => e.id === ctxMenu.targetId);
                if (edge) onEdgeDoubleClick(null, edge);
                closeCtxMenu();
              }}>编辑属性</div>
            </>
          )}
        </div>
      )}

      {/* 属性编辑弹窗 */}
      {editor && (
        <PropertyModal
          type={editor.type}
          nodeSnapshot={editor.nodeSnapshot}
          edgeSnapshot={editor.edgeSnapshot}
          children={editor.children}
          onSave={handleEditorSave}
          onClose={() => setEditor(null)}
        />
      )}

      {/* 版本历史弹窗 */}
      {showVersions && (
        <VersionModal
          onClose={() => setShowVersions(false)}
          onRestored={() => { setShowVersions(false); load(); }}
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

const ctxItem = {
  padding: '6px 16px', fontSize: 13, cursor: 'pointer',
  color: 'var(--text, #18181b)',
  borderRadius: 4, margin: '0 4px',
};
