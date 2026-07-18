/* ===================================================
   WeMonitor — 用户管理页
   =================================================== */

async function loadUsers() {
  const data = await api('/admin/users');
  if (!data) return;

  const tbody = document.getElementById('users-body');
  if (!data.users || data.users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">暂无用户</td></tr>';
    return;
  }

  tbody.innerHTML = data.users.map(u => {
    const roleBadge = u.role === 'admin'
      ? '<span class="status-badge" style="background:var(--accent-bg); color:var(--accent)">管理员</span>'
      : '<span class="status-badge" style="background:var(--bg); color:var(--text-dim)">普通用户</span>';
    const statusBadge = u.status === 'active'
      ? '<span class="status-badge status-healthy">已激活</span>'
      : '<span class="status-badge" style="background:var(--warning-bg); color:var(--warning)">待审批</span>';

    let actions = '';
    if (u.status === 'pending') {
      actions = `<button class="btn btn-primary btn-sm" onclick="approveUser(${u.id})">审批通过</button>`;
    }
    actions += ` <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id}, '${escapeHtml(u.username)}')">删除</button>`;

    return `
      <tr>
        <td><strong>${escapeHtml(u.username)}</strong></td>
        <td>${roleBadge}</td>
        <td>${statusBadge}</td>
        <td>${formatDateTime(u.created_at)}</td>
        <td>${actions}</td>
      </tr>
    `;
  }).join('');

  refreshIcons();
}

async function approveUser(id) {
  const res = await fetch('/api/v1/admin/users/' + id + '/approve', { method: 'POST' });
  if (res.ok) {
    loadUsers();
  } else {
    const err = await res.json();
    alert('审批失败: ' + (err.error || '未知错误'));
  }
}

async function deleteUser(id, name) {
  if (!confirm('确定删除用户 "' + name + '"？')) return;
  const res = await fetch('/api/v1/admin/users/' + id, { method: 'DELETE' });
  if (res.ok) {
    loadUsers();
  } else {
    const err = await res.json();
    alert('删除失败: ' + (err.error || '未知错误'));
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function refreshPage() { loadUsers(); }
loadUsers();
