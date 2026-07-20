/* ===================================================
   WeMonitor — Tunnel 管理页
   =================================================== */

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function loadTunnelStatus() {
  const t0 = performance.now();
  let res;
  try {
    res = await fetch('/api/v1/tunnel/status');
  } catch (err) {
    document.getElementById('tunnel-status-badge').textContent = '网络错误';
    console.error('[tunnel] status fetch failed:', err);
    return;
  }
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
  document.getElementById('tunnel-connections').textContent =
    data.connections !== undefined ? data.connections : '--';
  document.getElementById('tunnel-locations').textContent =
    data.locations && data.locations.length > 0 ? data.locations.join(', ') : '--';

  // 优先用 ISO 8601 时间戳（服务端已转换），兜底兼容旧的 activeSince 字段
  const sinceStr = data.activeSinceISO || data.activeSince;
  if (sinceStr) {
    const since = new Date(sinceStr);
    if (!isNaN(since.getTime())) {
      const diffSec = Math.floor((Date.now() - since.getTime()) / 1000);
      document.getElementById('tunnel-uptime').textContent = formatUptime(Math.max(0, diffSec));
    } else {
      document.getElementById('tunnel-uptime').textContent = '--';
    }
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
  let res;
  try {
    res = await fetch('/api/v1/tunnel/logs?lines=50');
  } catch (err) {
    document.getElementById('tunnel-logs').textContent = '网络错误: ' + err.message;
    console.error('[tunnel] logs fetch failed:', err);
    return;
  }
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

async function loadTunnelRoutes() {
  const container = document.getElementById('tunnel-routes-container');
  container.innerHTML = '<div class="text-dim" style="padding:calc(var(--font-size)*2) 0;text-align:center;">加载中...</div>';

  try {
    const res = await fetch('/api/v1/tunnel/routes');

    const ct = res.headers.get('content-type') || '';
    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      if (ct.includes('application/json')) {
        try { const errData = await res.json(); errMsg = errData.error || errMsg; } catch (_) {}
      }
      throw new Error(errMsg);
    }

    const data = await res.json();

    if (!data.success) {
      container.innerHTML = `<div class="text-danger" style="padding:calc(var(--font-size)*2) 0;text-align:center;">加载失败: ${escHtml(data.error || '未知错误')}</div>`;
      return;
    }

    if (data.routes.length === 0) {
      container.innerHTML = '<div class="text-dim" style="padding:calc(var(--font-size)*2) 0;text-align:center;">暂无路由配置</div>';
      return;
    }

    // 按 hostname 分组，保持原始顺序
    const groups = [];
    const seen = new Map();
    for (const r of data.routes) {
      if (seen.has(r.hostname)) {
        groups[seen.get(r.hostname)].routes.push(r);
      } else {
        seen.set(r.hostname, groups.length);
        groups.push({ hostname: r.hostname, service: r.service, routes: [r] });
      }
    }

    container.innerHTML = groups.map(g => {
      const pathBadges = g.routes.map(r => {
        if (r.path) {
          return `<span class="route-path-badge">${escHtml(r.path)}</span>`;
        }
        return `<span class="route-path-badge route-path-catchall">全部路由</span>`;
      }).join('');

      return `
        <div class="route-group-card">
          <div class="route-group-top">
            <div class="route-group-domain">
              <i data-lucide="globe" class="icon-sm route-group-icon"></i>
              <span class="route-group-hostname">${escHtml(g.hostname)}</span>
            </div>
            <code class="route-group-service">${escHtml(g.service)}</code>
          </div>
          <div class="route-group-paths">${pathBadges}</div>
        </div>
      `;
    }).join('');

    refreshIcons();
  } catch (err) {
    container.innerHTML = `<div class="text-danger" style="padding:calc(var(--font-size)*2) 0;text-align:center;">加载失败: ${escHtml(err.message)}</div>`;
    console.error('[tunnel] routes fetch failed:', err);
  }
}

function refreshPage() {
  loadTunnelStatus();
  loadTunnelLogs();
  loadTunnelRoutes();
}

loadTunnelStatus();
loadTunnelLogs();
loadTunnelRoutes();
