// WeAuto 面板：状态卡 + 执行历史 + 手动触发
// 依赖 common.js 提供的 api() / escapeHtml() / refreshIcons()

// 业务状态 → 徽章样式与文案（样式类见 style.css 的 .status-badge 变体）
const AUTO_STATUS = {
  success:          { cls: 'status-healthy',   label: '签到成功' },
  'already-signed': { cls: 'status-healthy',   label: '今日已签' },
  skipped:          { cls: '',                 label: '已跳过' },
  failed:           { cls: 'status-unhealthy', label: '失败' },
  blocked:          { cls: 'status-warning',   label: '被拦截' },
  'network-error':  { cls: 'status-unhealthy', label: '网络错误' },
  'config-error':   { cls: 'status-unhealthy', label: '配置错误' },
};

function autoBadge(status) {
  const m = AUTO_STATUS[status] || { cls: '', label: status || '未知' };
  return `<span class="status-badge ${m.cls}">${escapeHtml(m.label)}</span>`;
}

function autoTodayText(task) {
  if (!task.todayStatus) return '<span class="text-dim">今日待执行</span>';
  const when = task.todayTime ? `<span class="text-dim" style="font-size:12px;"> ${escapeHtml(task.todayTime.slice(11))}</span>` : '';
  return autoBadge(task.todayStatus) + when;
}

function renderAutoTasks(data) {
  const box = document.getElementById('auto-tasks');
  if (!box) return;

  if (!data.available) {
    box.innerHTML = `
      <div class="alert alert-warning">
        无法获取任务清单：${escapeHtml(data.error || '未知错误')}<br>
        目录：<code>${escapeHtml(data.dir)}</code>
      </div>`;
    return;
  }

  if (!data.tasks.length) {
    box.innerHTML = '<span class="text-dim">暂无已注册任务</span>';
    return;
  }

  box.innerHTML = `<div style="display:flex; flex-wrap:wrap; gap:12px;">${data.tasks
    .map((t) => {
      const lastOk = t.lastSuccess;
      const remain = (lastOk && lastOk.data && lastOk.data.remainTraffic) || '--';
      const expire = (lastOk && lastOk.data && lastOk.data.expire) || '--';
      const lastOkTime = lastOk ? escapeHtml(lastOk.time || '') : '<span class="text-dim">从未成功</span>';
      const target = t.target ? escapeHtml(t.target.targetLabel) : '--';
      const win = t.window ? `${escapeHtml(t.window.start)}–${escapeHtml(t.window.end)}` : '不设窗口';

      return `
      <div style="flex:1 1 340px; min-width:300px; border:1px solid var(--border); border-radius:var(--radius); padding:14px;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
          <i data-lucide="zap" class="icon-sm"></i>
          <strong>${escapeHtml(t.displayName || t.name)}</strong>
          <span style="margin-left:auto;">${autoTodayText(t)}</span>
        </div>
        <div style="display:grid; grid-template-columns:auto 1fr; gap:6px 14px; font-size:13px;">
          <span class="text-dim">剩余流量</span><span>${escapeHtml(String(remain))}</span>
          <span class="text-dim">套餐到期</span><span>${escapeHtml(String(expire))}</span>
          <span class="text-dim">今日目标</span><span>${target}<span class="text-dim"> （窗口 ${win}）</span></span>
          <span class="text-dim">上次成功</span><span>${lastOkTime}</span>
        </div>
        <div style="margin-top:12px;">
          <button class="btn btn-primary btn-sm" onclick="triggerAutoTask('${escapeHtml(t.name)}', this)">
            <i data-lucide="play" class="icon-sm"></i> 立即执行
          </button>
        </div>
      </div>`;
    })
    .join('')}</div>`;

  refreshIcons();
}

function renderAutoRuns(runs) {
  const tbody = document.getElementById('auto-runs');
  if (!tbody) return;

  if (!runs.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">暂无执行记录</td></tr>';
    return;
  }

  tbody.innerHTML = runs
    .map((r) => {
      const dur = r.dur != null ? `${(r.dur / 1000).toFixed(1)}s` : '--';
      const forced = r.force ? ' <span class="text-dim" style="font-size:12px;">(手动)</span>' : '';
      return `
        <tr>
          <td>${escapeHtml(r.time || '')}</td>
          <td>${escapeHtml(r.task || '')}${forced}</td>
          <td>${autoBadge(r.status)}</td>
          <td>${escapeHtml(r.message || '')}</td>
          <td class="text-dim">${dur}</td>
        </tr>`;
    })
    .join('');
}

async function loadAutoStatus() {
  const data = await api('/auto/status', { skipCache: true });
  if (!data) return;

  const verEl = document.getElementById('auto-version');
  if (verEl) {
    const parts = [];
    if (data.version) parts.push(`版本 ${escapeHtml(data.version)}`);
    parts.push(escapeHtml(data.dir));
    verEl.textContent = parts.join(' · ');
  }

  renderAutoTasks(data);

  const statsEl = document.getElementById('auto-stats');
  if (statsEl && data.stats) {
    statsEl.textContent = `共 ${data.stats.total} 次执行，成功 ${data.stats.success}，失败 ${data.stats.failed}`;
  }
}

async function loadAutoRuns() {
  const data = await api('/auto/runs?limit=50', { skipCache: true });
  if (!data) return;
  renderAutoRuns(data.runs || []);
}

async function triggerAutoTask(name, btn) {
  if (!confirm(`确定立即执行「${name}」吗？\n\n将忽略调度窗口与幂等检查，真实执行一次任务。`)) return;

  const original = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" class="icon-sm"></i> 执行中...';
    refreshIcons();
  }

  try {
    const res = await fetch('/api/v1/auto/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: name }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.ok) {
      alert(`执行完成：\n\n${data.output || '(无输出)'}`);
    } else {
      alert(`执行失败：\n\n${data.output || data.error || `HTTP ${res.status}`}`);
    }
  } catch (err) {
    alert(`请求失败：${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
      refreshIcons();
    }
    loadAutoStatus();
    loadAutoRuns();
  }
}

function refreshPage() {
  loadAutoStatus();
  loadAutoRuns();
}

loadAutoStatus();
loadAutoRuns();
