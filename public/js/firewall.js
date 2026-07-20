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

// IP/CIDR 格式校验（前端）
function isValidIpOrCidr(value) {
  if (!value || value === 'any' || value === 'Anywhere') return true;
  const cidrMatch = value.match(/^(.+?)\/(\d+)$/);
  let ip = value, mask = -1;
  if (cidrMatch) {
    ip = cidrMatch[1];
    mask = parseInt(cidrMatch[2], 10);
  }
  // IPv4
  const ipv4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    if (!ipv4.slice(1).every(o => parseInt(o, 10) <= 255)) return false;
    if (mask >= 0) return mask >= 0 && mask <= 32;
    return true;
  }
  // IPv6 简化校验
  const ipv6 = ip.match(/^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/);
  if (ipv6) {
    if (mask >= 0) return mask >= 0 && mask <= 128;
    return true;
  }
  return false;
}

function showAddRuleForm() {
  fwEditNumber = null;
  document.getElementById('fw-modal-title').textContent = '添加防火墙规则';
  document.getElementById('fw-submit-btn').textContent = '添加';
  document.getElementById('fw-port').value = '';
  document.getElementById('fw-protocol').value = 'tcp';
  document.getElementById('fw-from').value = '';
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
  document.getElementById('fw-from').value = (rule.from && rule.from !== 'Anywhere') ? rule.from : '';
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
  const from = document.getElementById('fw-from').value.trim();
  const comment = document.getElementById('fw-comment').value.trim();

  if (!port) { alert('请输入端口号'); return; }
  if (from && !isValidIpOrCidr(from)) {
    alert('来源 IP 格式无效，支持 IPv4/IPv6/CIDR，如 192.168.1.100 或 10.0.0.0/24');
    return;
  }

  const body = JSON.stringify({ port, protocol, comment, from });
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

function refreshPage() {
  loadFirewall();
}

loadFirewall();
