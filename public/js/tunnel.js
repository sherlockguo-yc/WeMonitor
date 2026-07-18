/* ===================================================
   WeMonitor — Tunnel 管理页
   =================================================== */

async function loadTunnelStatus() {
  const t0 = performance.now();
  const res = await fetch('/api/v1/tunnel/status');
  if (!res.ok) {
    document.getElementById('tunnel-status-badge').textContent = 'API 错误';
    return;
  }
  const data = await res.json();
  console.log(`[client] tunnel/status fetch=${Math.round(performance.now() - t0)}ms`);

  const badge = document.getElementById('tunnel-status-badge');
  if (data.active) {
    badge.className = 'status-badge status-healthy';
    badge.textContent = '运行中';
  } else {
    badge.className = 'status-badge status-unhealthy';
    badge.textContent = '已停止';
  }

  document.getElementById('tunnel-name').textContent = data.name || '--';
  document.getElementById('tunnel-connections').textContent = data.connections;
  document.getElementById('tunnel-locations').textContent =
    data.locations && data.locations.length > 0 ? data.locations.join(', ') : '--';

  if (data.activeSince) {
    const since = new Date(data.activeSince.replace(' UTC', 'Z'));
    const diffSec = Math.floor((Date.now() - since.getTime()) / 1000);
    document.getElementById('tunnel-uptime').textContent = formatUptime(diffSec);
  } else {
    document.getElementById('tunnel-uptime').textContent = '--';
  }
  if (data.serviceError) {
    document.getElementById('tunnel-uptime').textContent = '错误: ' + data.serviceError;
  }
  refreshIcons();
}

async function restartTunnel() {
  const btn = document.getElementById('btn-restart');
  btn.disabled = true;
  btn.textContent = '重启中...';

  const res = await fetch('/api/v1/tunnel/restart', { method: 'POST' });
  const data = await res.json();

  const result = document.getElementById('restart-result');
  if (data.success) {
    result.textContent = '✅ 重启成功，等待重连...';
    result.style.color = 'var(--success)';
    setTimeout(() => loadTunnelStatus(), 5000);
  } else {
    result.textContent = '❌ 重启失败: ' + (data.error || data.stderr || '未知错误');
    result.style.color = 'var(--danger)';
  }

  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="refresh-cw" class="icon-sm"></i> 重启 Tunnel';
  refreshIcons();
}

async function addTunnelRoute() {
  const hostname = document.getElementById('route-hostname').value.trim();
  if (!hostname) { alert('请输入子域名'); return; }

  const res = await fetch('/api/v1/tunnel/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostname })
  });
  const data = await res.json();

  const result = document.getElementById('route-result');
  if (data.success) {
    result.textContent = '✅ DNS 路由已添加: ' + hostname;
    result.style.color = 'var(--success)';
    document.getElementById('route-hostname').value = '';
  } else {
    result.textContent = '❌ 添加失败: ' + (data.error || data.stderr || '未知错误');
    result.style.color = 'var(--danger)';
  }
}

async function loadTunnelLogs() {
  const t0 = performance.now();
  document.getElementById('tunnel-logs').textContent = '加载中...';
  const res = await fetch('/api/v1/tunnel/logs?lines=50');
  const data = await res.json();
  const logEl = document.getElementById('tunnel-logs');
  if (data.lines && data.lines.length > 0) {
    logEl.textContent = data.lines.join('\n');
  } else if (data.error) {
    logEl.textContent = '获取日志失败: ' + data.error;
  } else {
    logEl.textContent = '(暂无日志)';
  }
  console.log(`[client] tunnel/logs fetch=${Math.round(performance.now() - t0)}ms`);
}

function refreshPage() {
  loadTunnelStatus();
  loadTunnelLogs();
}

loadTunnelStatus();
loadTunnelLogs();
