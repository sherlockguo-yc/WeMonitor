/* ===================================================
   WeMonitor -- Data Backup Page
   =================================================== */

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function(c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function toast(msg) {
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(function() { el.classList.add('show'); });
  setTimeout(function() { el.classList.remove('show'); setTimeout(function() { el.remove(); }, 300); }, 3000);
}

async function loadBackupPage() {
  var data = await api('/backup/services');
  if (!data) {
    document.getElementById('backup-services-body').innerHTML =
      '<tr><td colspan="5" class="empty-state">加载失败</td></tr>';
    return;
  }
  var services = data.services;
  var tbody = document.getElementById('backup-services-body');
  if (!services || services.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">暂无服务</td></tr>';
    return;
  }
  tbody.innerHTML = services.map(function(s) {
    return '<tr>' +
      '<td><strong>' + escapeHtml(s.name) + '</strong>' +
        (s.service_enabled ? '' : ' <span class="badge badge-offline">已停用</span>') + '</td>' +
      '<td><label class="toggle-switch" onclick="event.stopPropagation()">' +
        '<input type="checkbox" ' + (s.backup_enabled ? 'checked' : '') +
        ' onchange="toggleBackup(\'' + escapeHtml(s.name) + '\', this.checked)">' +
        '<span class="toggle-track"></span></label>' +
        '<span style="margin-left:8px;font-size:calc(var(--font-size)*0.85);color:' +
        (s.backup_enabled ? 'var(--accent)' : 'var(--text-dim)') + '">' +
        (s.backup_enabled ? '已启用' : '未启用') + '</span></td>' +
      '<td style="font-family:var(--font-mono);font-size:calc(var(--font-size)*0.82)">' +
        (s.last_backup_at ? formatTime(s.last_backup_at) : '—') + '</td>' +
      '<td style="font-family:var(--font-mono);font-size:calc(var(--font-size)*0.82)">' +
        (s.last_backup_size ? formatSize(s.last_backup_size) : '—') + '</td>' +
      '<td style="font-family:var(--font-mono);font-size:calc(var(--font-size)*0.82);color:var(--text-dim)">' +
        escapeHtml(s.r2_path) + '</td></tr>';
  }).join('');
}

async function toggleBackup(name, checked) {
  try {
    var resp = await fetch('/api/v1/backup/services/' + encodeURIComponent(name) + '/toggle', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    });
    var result = await resp.json();
    if (!resp.ok) throw new Error(result.error || '请求失败');
    if (result.backup_enabled !== checked) loadBackupPage();
  } catch (e) {
    toast('操作失败：' + e.message);
    loadBackupPage();
  }
}

function refreshPage() { loadBackupPage(); }
document.addEventListener('DOMContentLoaded', loadBackupPage);
