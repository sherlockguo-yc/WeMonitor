/* ===================================================
   WeMonitor — 用户管理页
   =================================================== */

async function loadUsers(skipCache = false) {
  const data = await api('/admin/users', { skipCache });
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

    const isSelf = u.id === window.CURRENT_USER_ID;
    let actions = '';
    if (u.status === 'pending') {
      actions = `<button class="btn btn-primary btn-sm" onclick="approveUser(${u.id})">审批通过</button>`;
    }
    if (u.status === 'active') {
      if (u.role === 'admin') {
        if (!isSelf) {
          actions += `<button class="btn btn-sm" style="color:var(--warning);border-color:var(--warning)" onclick="toggleRole(${u.id},'user')">取消管理员</button>`;
        }
      } else {
        actions += `<button class="btn btn-primary btn-sm" onclick="toggleRole(${u.id},'admin')">设为管理员</button>`;
      }
    }
    if (!isSelf) {
      actions += ` <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id}, '${escapeHtml(u.username)}')">删除</button>`;
    }

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
    loadUsers(true);  // 跳过缓存，确保立即反映审批结果
  } else {
    const err = await res.json();
    alert('审批失败: ' + (err.error || '未知错误'));
  }
}

async function toggleRole(id, newRole) {
  const res = await fetch('/api/v1/admin/users/' + id + '/role', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: newRole })
  });
  if (res.ok) {
    loadUsers(true);
  } else {
    const err = await res.json();
    alert('操作失败: ' + (err.error || '未知错误'));
  }
}

async function deleteUser(id, name) {
  if (!confirm('确定删除用户 "' + name + '"？')) return;
  const res = await fetch('/api/v1/admin/users/' + id, { method: 'DELETE' });
  if (res.ok) {
    loadUsers(true);  // 跳过缓存，确保立即反映删除结果
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
