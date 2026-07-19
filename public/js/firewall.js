/* ===================================================
   WeMonitor — 防火墙管理页
   =================================================== */

let fwEditNumber = null; // 非 null 表示编辑模式
let fwRulesCache = [];   // 缓存当前规则列表

async function loadFirewall() {
  const data = await api('/firewall/status');
  if (!data) return;

  fwRulesCache = data.rules || [];

  // 状态
  const badge = document.getElementById('fw-status-badge');
  if (data.status === 'active') {
    badge.className = 'status-badge status-healthy';
    badge.textContent = '已启用';
  } else {
    badge.className = 'status-badge status-unhealthy';
    badge.textContent = '未启用';
  }

  // 规则表格
  const tbody = document.getElementById('fw-rules-body');
  if (!data.rules || data.rules.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">暂无规则</td></tr>';
    return;
  }

  tbody.innerHTML = data.rules.map(r => {
    const actionBadge = r.action === 'ALLOW'
      ? '<span class="status-badge status-healthy">允许</span>'
      : '<span class="status-badge status-unhealthy">拒绝</span>';
    return `
      <tr>
        <td>${r.number}</td>
        <td><strong>${escapeHtml(String(r.port))}</strong></td>
        <td>${escapeHtml((r.protocol || '').toUpperCase())}</td>
        <td>${actionBadge}</td>
        <td>${escapeHtml(r.from || 'Anywhere')}</td>
        <td>${escapeHtml(r.comment || '')}</td>
        <td>
          <button class="btn btn-sm" onclick="editRule(${r.number})" title="编辑"><i data-lucide="pencil" class="icon-sm"></i></button>
          <button class="btn btn-danger btn-sm" onclick="deleteRule(${r.number})">删除</button>
        </td>
      </tr>
    `;
  }).join('');

  refreshIcons();
}

function showAddRuleForm() {
  fwEditNumber = null;
  document.getElementById('fw-modal-title').textContent = '添加防火墙规则';
  document.getElementById('fw-submit-btn').textContent = '添加';
  document.getElementById('fw-port').value = '';
  document.getElementById('fw-protocol').value = 'tcp';
  document.getElementById('fw-comment').value = '';
  document.getElementById('fw-modal').style.display = 'flex';
}

function editRule(number) {
  const rule = fwRulesCache.find(r => r.number === number);
  if (!rule) { alert('未找到规则 #' + number); return; }

  fwEditNumber = number;
  document.getElementById('fw-modal-title').textContent = '编辑防火墙规则';
  document.getElementById('fw-submit-btn').textContent = '保存';
  document.getElementById('fw-port').value = rule.port;
  document.getElementById('fw-protocol').value = rule.protocol || 'tcp';
  document.getElementById('fw-comment').value = rule.comment || '';
  document.getElementById('fw-modal').style.display = 'flex';
}

function closeFwModal() {
  document.getElementById('fw-modal').style.display = 'none';
  fwEditNumber = null;
}

async function submitFwRule() {
  const port = document.getElementById('fw-port').value.trim();
  const protocol = document.getElementById('fw-protocol').value;
  const comment = document.getElementById('fw-comment').value.trim();

  if (!port) { alert('请输入端口号'); return; }

  const body = JSON.stringify({ port, protocol, comment });
  let url = '/api/v1/firewall/rules';
  let method = 'POST';

  if (fwEditNumber !== null) {
    url += '/' + fwEditNumber;
    method = 'PUT';
  }

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body
  });

  if (res.ok) {
    closeFwModal();
    loadFirewall();
  } else {
    const err = await res.json();
    const action = fwEditNumber !== null ? '编辑' : '添加';
    alert(action + '失败: ' + (err.error || err.stderr || '未知错误'));
  }
}

async function deleteRule(number) {
  if (!confirm('确定删除规则 #' + number + '？')) return;

  const res = await fetch('/api/v1/firewall/rules/' + number, { method: 'DELETE' });
  if (res.ok) {
    loadFirewall();
  } else {
    const err = await res.json();
    alert('删除失败: ' + (err.error || err.stderr || '未知错误'));
  }
}

document.getElementById('fw-modal').addEventListener('click', function(e) {
  if (e.target === this) closeFwModal();
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function refreshPage() {
  loadFirewall();
}

loadFirewall();
