/* ===================================================
   WeMonitor — 服务管理页
   =================================================== */

async function loadSettings() {
  const services = await api('/services');
  const tbody = document.getElementById('settings-services-body');

  if (!services || services.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">暂无服务</td></tr>';
    return;
  }

  tbody.innerHTML = services.map(s => `
    <tr>
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td>${s.scrape_url ? '<span style="color: var(--accent);">Pull</span>' : '<span style="color: var(--text-dim);">Push</span>'}</td>
      <td style="font-family: var(--font-mono); font-size: calc(var(--font-size) * 0.82);">
        ${s.scrape_url ? escapeHtml(s.scrape_url) : (s.health_target ? escapeHtml(s.health_target) : '--')}
      </td>
      <td>${s.scrape_interval}s</td>
      <td>
        <label class="toggle-switch" onclick="event.stopPropagation()">
          <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="toggleService(${s.id}, this.checked)">
          <span class="toggle-track"></span>
        </label>
      </td>
      <td>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-secondary btn-sm" onclick="editService(${s.id})" title="编辑">编辑</button>
          <button class="btn btn-danger btn-sm" onclick="deleteServiceConfirm(${s.id}, '${escapeHtml(s.name)}')" title="删除">删除</button>
        </div>
      </td>
    </tr>
  `).join('');

  refreshIcons();
}

function showAddForm() {
  document.getElementById('modal-title').textContent = '新增服务';
  document.getElementById('edit-id').value = '';
  document.getElementById('svc-name').value = '';
  document.getElementById('svc-scrape-url').value = '';
  document.getElementById('svc-scrape-interval').value = '30';
  document.getElementById('svc-health-target').value = '';
  document.getElementById('service-modal').style.display = 'flex';
}

async function editService(id) {
  const services = await api('/services');
  const svc = services.find(s => s.id == id);
  if (!svc) return;

  document.getElementById('modal-title').textContent = '编辑服务';
  document.getElementById('edit-id').value = svc.id;
  document.getElementById('svc-name').value = svc.name;
  document.getElementById('svc-scrape-url').value = svc.scrape_url || '';
  document.getElementById('svc-scrape-interval').value = svc.scrape_interval || 30;
  document.getElementById('svc-health-target').value = svc.health_target || '';
  document.getElementById('service-modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('service-modal').style.display = 'none';
}

async function saveService() {
  const id = document.getElementById('edit-id').value;
  const name = document.getElementById('svc-name').value.trim();
  const scrape_url = document.getElementById('svc-scrape-url').value.trim() || null;
  const scrape_interval = parseInt(document.getElementById('svc-scrape-interval').value) || 30;
  const health_target = document.getElementById('svc-health-target').value.trim() || null;

  if (!name) {
    alert('请输入服务名');
    return;
  }

  const body = { name, scrape_url, scrape_interval, health_type: 'tcp', health_target };

  if (id) {
    // 更新
    const res = await fetch('/api/v1/services/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      closeModal();
      loadSettings();
    } else {
      const err = await res.json();
      alert('保存失败: ' + (err.error || '未知错误'));
    }
  } else {
    // 创建
    const res = await fetch('/api/v1/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      closeModal();
      loadSettings();
    } else {
      const err = await res.json();
      alert('创建失败: ' + (err.error || '未知错误'));
    }
  }
}

async function toggleService(id, enabled) {
  await fetch('/api/v1/services/' + id + '/toggle', { method: 'PATCH' });
  loadSettings();
}

async function deleteServiceConfirm(id, name) {
  if (!confirm('确定删除服务 "' + name + '"？此操作不可撤销。')) return;
  await fetch('/api/v1/services/' + id, { method: 'DELETE' });
  loadSettings();
}

// 点击模态框背景关闭
document.getElementById('service-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function refreshPage() {
  loadSettings();
}

loadSettings();
