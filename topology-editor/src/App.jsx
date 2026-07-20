import React, { useState, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import TopologyNode from './nodes/TopologyNode';
import { fetchTopology, saveTopology, fetchStatus } from './api';

const nodeTypes = { topology: TopologyNode };

// 从实时状态计算每个节点的 status
function computeStatuses(topologyNodes, statusData) {
  const { physical, firewall, tunnel, health } = statusData;

  return topologyNodes.map(node => {
    const d = node.data || {};

    if (!d.dynamic) return { ...node, data: { ...d, status: 'static', isDynamic: false } };

    let status = 'unknown';
    switch (d.dynamic) {
      case 'modem':
        if (physical?.modem) status = physical.modem.online ? 'ok' : 'error';
        break;
      case 'router':
        if (physical?.router) status = physical.router.online ? 'ok' : 'error';
        break;
      case 'n150':
        if (physical?.n150) status = physical.n150.online ? 'ok' : 'error';
        break;
      case 'firewall':
        if (firewall) status = firewall.status === 'active' ? 'ok' : 'error';
        break;
      case 'tunnel':
        if (tunnel) status = tunnel.active ? 'ok' : 'error';
        break;
      case 'health':
        if (d.healthIdx === -1) status = 'ok';
        else if (Array.isArray(health)) {
          const nameMap = { 0: 'WeMusic', 1: 'WeDownload' };
          const svc = health.find(h => h.name === nameMap[d.healthIdx]);
          if (svc) status = svc.status === 'healthy' ? 'ok' : 'error';
        }
        break;
    }

    return { ...node, data: { ...d, status, isDynamic: true } };
  });
}

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [statusData, setStatusData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // 加载拓扑配置 + 实时状态
  const load = useCallback(async () => {
    try {
      const [topo, st] = await Promise.all([fetchTopology(), fetchStatus()]);
      setStatusData(st);
      const withStatus = computeStatuses(topo.nodes, st);
      setNodes(withStatus);
      setEdges(topo.edges.map((e, i) => ({
        ...e,
        id: e.id || `e-${i}`,
        type: 'smoothstep',
        animated: false,
      })));
      setMsg('');
    } catch (err) {
      setMsg('加载失败: ' + err.message);
    }
  }, [setNodes, setEdges]);

  useEffect(() => { load(); }, [load]);

  // 定时刷新状态（每 15 秒）
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const st = await fetchStatus();
        setStatusData(st);
        setNodes(nds => computeStatuses(nds, st));
      } catch (_) {}
    }, 15000);
    return () => clearInterval(timer);
  }, [setNodes]);

  // 保存拓扑
  const save = useCallback(async () => {
    setSaving(true);
    try {
      const topo = {
        nodes: nodes.map(n => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: {
            label: n.data.label,
            port: n.data.port,
            dynamic: n.data.dynamic,
            healthIdx: n.data.healthIdx,
            width: n.data.width,
          },
        })),
        edges: edges.map(e => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label || '',
          style: e.style || 'solid',
        })),
      };
      await saveTopology(topo);
      setMsg('保存成功');
      setTimeout(() => setMsg(''), 2000);
    } catch (err) {
      setMsg('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  }, [nodes, edges]);

  const onConnect = useCallback((params) => {
    setEdges(eds => addEdge({
      ...params,
      type: 'smoothstep',
      label: '',
      style: 'solid',
    }, eds));
  }, [setEdges]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 工具栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        background: 'var(--bg-card, #fff)',
        borderBottom: '1px solid var(--border, #e4e4e7)',
        fontSize: 14,
      }}>
        <span style={{ fontWeight: 600 }}>网络拓扑编辑器</span>
        <span style={{ color: 'var(--text-dim, #a1a1aa)', fontSize: 12 }}>
          拖拽节点移动 · 点击节点端口连线 · 双击节点改标签 · 选中后 Delete 删除
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={load} style={btnStyle}>刷新</button>
        <button onClick={save} disabled={saving} style={{ ...btnStyle, background: saving ? '#a1a1aa' : 'var(--accent, #6366f1)', color: '#fff' }}>
          {saving ? '保存中...' : '保存'}
        </button>
        {msg && <span style={{ color: msg.includes('失败') ? 'var(--danger, #ef4444)' : 'var(--success, #10b981)', fontSize: 13 }}>{msg}</span>}
      </div>

      {/* 画布 */}
      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          deleteKeyCode="Delete"
          multiSelectionKeyCode="Shift"
          snapToGrid
          snapGrid={[10, 10]}
        >
          <Controls />
          <Background gap={20} size={1} color="var(--border-light, #e4e4e7)" />
          <MiniMap nodeStrokeWidth={2} pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}

const btnStyle = {
  padding: '4px 14px',
  borderRadius: 6,
  border: '1px solid var(--border, #d4d4d8)',
  background: 'var(--bg-card, #fff)',
  color: 'var(--text, #18181b)',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 500,
};
