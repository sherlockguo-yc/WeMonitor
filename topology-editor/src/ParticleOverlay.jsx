import React, { useEffect, useRef } from 'react';
import { useViewport } from '@xyflow/react';
import { startParticles, stopParticles } from './particles';

// 流量粒子覆盖层：独立 SVG 浮在 React Flow 画布上，
// 内层 <g> 的 transform 与 viewport 同步，球坐标直接用 flow 坐标系
function ParticleOverlay({ getEdgeSourceStatus }) {
  const { x, y, zoom } = useViewport();
  const gRef = useRef(null);

  useEffect(() => {
    // React Flow 边 DOM 渲染有延迟，重试直至挂载
    let attempts = 0, timer = null;
    const tryStart = () => {
      attempts++;
      if (!startParticles(gRef.current, getEdgeSourceStatus) && attempts < 20) {
        timer = setTimeout(tryStart, 300);
      }
    };
    timer = setTimeout(tryStart, 300);
    return () => { clearTimeout(timer); stopParticles(); };
  }, [getEdgeSourceStatus]);

  return (
    <svg
      style={{
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 5, overflow: 'visible',
      }}
    >
      <g ref={gRef} className="topology-particles" transform={`translate(${x},${y}) scale(${zoom})`} />
    </svg>
  );
}

export default React.memo(ParticleOverlay);
