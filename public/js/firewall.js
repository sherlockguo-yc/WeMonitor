/* ===================================================
   WeMonitor — 防火墙管理页
   =================================================== */

async function loadFirewall() {
  const data = await api('/firewall/status');
  if (!data) return;

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
          <button class="btn btn-danger btn-sm" onclick="deleteRule(${r.number})">删除</button>
        </td>
      </tr>
    `;
  }).join('');

  refreshIcons();
}

function showAddRuleForm() {
  document.getElementById('fw-modal').style.display = 'flex';
}

function closeFwModal() {
  document.getElementById('fw-modal').style.display = 'none';
}

async function addFwRule() {
  const port = document.getElementById('fw-port').value.trim();
  const protocol = document.getElementById('fw-protocol').value;
  const comment = document.getElementById('fw-comment').value.trim();

  if (!port) { alert('请输入端口号'); return; }

  const res = await fetch('/api/v1/firewall/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port, protocol, comment })
  });

  if (res.ok) {
    closeFwModal();
    // 清空表单
    document.getElementById('fw-port').value = '';
    document.getElementById('fw-comment').value = '';
    loadFirewall();
  } else {
    const err = await res.json();
    alert('添加失败: ' + (err.error || err.stderr || '未知错误'));
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
