/* ===================================================
   WeMonitor — 定时任务管理页
   =================================================== */

let cronEditId = null;     // 非 null 表示编辑模式
let cronJobsCache = [];    // 缓存当前任务列表

// ── 加载任务列表 ──
async function loadCronJobs() {
  const data = await api('/cron/jobs', { skipCache: true });
  if (!data) return;

  cronJobsCache = data.jobs || [];

  // 同步状态警告
  const warning = document.getElementById('sync-warning');
  if (data.sync && !data.sync.inSync) {
    warning.style.display = 'flex';
    document.getElementById('sync-warning-text').textContent =
      '系统 crontab 与 WeMonitor 配置不一致，可能是手动修改了 crontab';
  } else {
    warning.style.display = 'none';
  }

  // 渲染表格
  const tbody = document.getElementById('cron-jobs-body');
  if (!cronJobsCache.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">暂无定时任务，点击「新增任务」创建</td></tr>';
    return;
  }

  tbody.innerHTML = cronJobsCache.map(j => {
    const name = escapeHtml(j.name || '未命名');
    const schedule = escapeHtml(j.schedule);
    const cmdDisplay = escapeHtml(j.command.length > 60 ? j.command.slice(0, 60) + '...' : j.command);
    const checked = j.enabled ? 'checked' : '';
    const lastRunHtml = renderLastRun(j.lastRun);
    return `
      <tr>
        <td title="${escapeHtml(j.name)}"><strong>${name}</strong></td>
        <td><code class="cron-expr" title="${schedule}">${schedule}</code></td>
        <td title="${escapeHtml(j.command)}"><code class="cron-cmd">${cmdDisplay}</code></td>
        <td>
          <label class="toggle-switch" title="${j.enabled ? '已启用' : '已禁用'}">
            <input type="checkbox" ${checked} onchange="toggleJob('${j.id}')">
            <span class="toggle-track"></span>
          </label>
        </td>
        <td>${lastRunHtml}</td>
        <td>
          <button class="btn btn-sm" onclick="showHistory('${j.id}','${escapeHtml(j.name)}')" title="运行历史"><i data-lucide="history" class="icon-sm"></i></button>
          <button class="btn btn-sm" onclick="editJob('${j.id}')" title="编辑"><i data-lucide="pencil" class="icon-sm"></i></button>
          <button class="btn btn-danger btn-sm" onclick="deleteJob('${j.id}','${escapeHtml(j.name)}')">删除</button>
        </td>
      </tr>
    `;
  }).join('');

  refreshIcons();
}

// ── 渲染上次运行状态 ──
function renderLastRun(run) {
  if (!run) return '<span class="text-dim">从未运行</span>';
  const d = new Date(run.ts * 1000);
  const time = formatDateTime(run.ts * 1000);
  const ok = run.exit === 0;
  const cls = ok ? 'status-healthy' : 'status-unhealthy';
  const label = ok ? '成功' : `失败(${run.exit})`;
  return `<span class="status-badge ${cls}" title="耗时 ${run.dur}s — ${time}">${label}</span>`;
}

// ── 新增任务 ──
function showJobForm() {
  cronEditId = null;
  document.getElementById('cron-modal-title').textContent = '新增定时任务';
  document.getElementById('cron-submit-btn').textContent = '创建';
  document.getElementById('cron-name').value = '';
  document.getElementById('cron-schedule').value = '';
  document.getElementById('cron-command').value = '';
  document.getElementById('cron-preset').value = '';
  document.getElementById('schedule-preview').textContent = '';
  document.getElementById('cron-modal').style.display = 'flex';
}

// ── 编辑任务 ──
function editJob(id) {
  const job = cronJobsCache.find(j => j.id === id);
  if (!job) return alert('任务不存在');

  cronEditId = id;
  document.getElementById('cron-modal-title').textContent = '编辑定时任务';
  document.getElementById('cron-submit-btn').textContent = '保存';
  document.getElementById('cron-name').value = job.name || '';
  document.getElementById('cron-schedule').value = job.schedule;
  document.getElementById('cron-command').value = job.command;
  document.getElementById('cron-preset').value = '';
  updateSchedulePreview();
  document.getElementById('cron-modal').style.display = 'flex';
}

function closeCronModal() {
  document.getElementById('cron-modal').style.display = 'none';
  cronEditId = null;
}

// ── 调度表达式预览 ──
function updateSchedulePreview() {
  const val = document.getElementById('cron-schedule').value.trim();
  const preview = describeCron(val);
  document.getElementById('schedule-preview').textContent = preview;
}

function applyPreset() {
  const preset = document.getElementById('cron-preset').value;
  if (preset) {
    document.getElementById('cron-schedule').value = preset;
    updateSchedulePreview();
  }
}

function describeCron(expr) {
  if (!expr) return '';
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return '表达式需要 5 个字段';

  const [min, hour, dom, month, dow] = fields;
  const parts = [];

  // 分
  if (min === '*') parts.push('每分钟');
  else if (min.startsWith('*/')) parts.push(`每 ${min.slice(2)} 分钟`);
  else parts.push(`第 ${min} 分`);

  // 时
  if (hour === '*') parts.push('每小时');
  else if (hour.startsWith('*/')) parts.push(`每 ${hour.slice(2)} 小时`);
  else parts.push(`${hour} 点`);

  // 日
  if (dom !== '*') parts.push(`${dom} 号`);

  // 月
  if (month !== '*') parts.push(`${month} 月`);

  // 周
  if (dow !== '*') {
    const weekNames = { 0: '周日', 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };
    parts.push(weekNames[dow] || `周${dow}`);
  }

  return '→ ' + parts.join(' ');
}

// ── 提交任务 ──
async function submitJob() {
  const name = document.getElementById('cron-name').value.trim();
  const schedule = document.getElementById('cron-schedule').value.trim();
  const command = document.getElementById('cron-command').value.trim();

  if (!schedule) return alert('请输入调度表达式');
  if (!command) return alert('请输入命令');

  const body = JSON.stringify({ name, schedule, command });
  let url = '/api/v1/cron/jobs';
  let method = 'POST';

  if (cronEditId) {
    url += '/' + cronEditId;
    method = 'PUT';
  }

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (res.ok) {
    closeCronModal();
    loadCronJobs();
  } else {
    const err = await res.json();
    alert((cronEditId ? '保存' : '创建') + '失败: ' + (err.error || '未知错误'));
  }
}

// ── 启用/禁用 ──
async function toggleJob(id) {
  const res = await fetch('/api/v1/cron/jobs/' + id + '/toggle', { method: 'POST' });
  if (!res.ok) {
    const err = await res.json();
    alert('操作失败: ' + (err.error || '未知错误'));
  }
  loadCronJobs();
}

// ── 删除 ──
async function deleteJob(id, name) {
  if (!confirm('确定删除任务「' + name + '」？')) return;
  const res = await fetch('/api/v1/cron/jobs/' + id, { method: 'DELETE' });
  if (res.ok) {
    loadCronJobs();
  } else {
    const err = await res.json();
    alert('删除失败: ' + (err.error || '未知错误'));
  }
}

// ── 强制同步 ──
async function forceSync() {
  const res = await fetch('/api/v1/cron/sync', { method: 'POST' });
  if (res.ok) {
    loadCronJobs();
  } else {
    const err = await res.json();
    alert('同步失败: ' + (err.error || '未知错误'));
  }
}

// ── 运行历史 ──
async function showHistory(id, name) {
  document.getElementById('history-modal-title').textContent = '运行历史 — ' + name;
  document.getElementById('history-body').innerHTML = '<p>加载中...</p>';
  document.getElementById('history-modal').style.display = 'flex';

  const data = await api('/cron/jobs/' + id + '/history?limit=50', { skipCache: true });
  if (!data) return;

  const history = data.history || [];
  const body = document.getElementById('history-body');

  if (!history.length) {
    body.innerHTML = '<p class="text-dim">暂无运行记录</p>';
    return;
  }

  body.innerHTML = history.map(h => {
    const d = new Date(h.ts * 1000);
    const time = formatDateTime(h.ts * 1000);
    const ok = h.exit === 0;
    const cls = ok ? 'status-healthy' : 'status-unhealthy';
    const label = ok ? '成功' : `退出码 ${h.exit}`;
    return `
      <div style="padding: 8px 0; border-bottom: 1px solid var(--border);">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <strong>${time}</strong>
          <span class="status-badge ${cls}" style="font-size: 12px;">${label}</span>
          <span class="text-dim" style="font-size: 12px;">耗时 ${h.dur} 秒</span>
        </div>
        ${h.out ? `<pre style="margin: 4px 0 0; padding: 8px; background: var(--bg); border-radius: var(--radius); font-size: 12px; max-height: 200px; overflow: auto; white-space: pre-wrap; word-break: break-all;">${escapeHtml(h.out)}</pre>` : ''}
      </div>
    `;
  }).join('');
}

function closeHistoryModal() {
  document.getElementById('history-modal').style.display = 'none';
}

// ── 模态框点击遮罩关闭 ──
document.getElementById('cron-modal').addEventListener('click', function(e) {
  if (e.target === this) closeCronModal();
});
document.getElementById('history-modal').addEventListener('click', function(e) {
  if (e.target === this) closeHistoryModal();
});

// 页面刷新入口
function refreshPage() {
  loadCronJobs();
}

loadCronJobs();
