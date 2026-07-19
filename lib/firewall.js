const { execFile } = require('child_process');

function ufw(args = []) {
  return new Promise((resolve, reject) => {
    execFile('sudo', ['ufw', ...args], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        // ufw 部分命令即使成功也会返回非零 exit code
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), error: err.message });
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), error: null });
      }
    });
  });
}

// 获取 UFW 状态和规则列表
async function getStatus() {
  const { stdout } = await ufw(['status', 'verbose']);
  if (!stdout) return { status: 'inactive', rules: [] };

  const lines = stdout.split('\n');
  let active = false;
  let defaultIncoming = 'deny';
  const rules = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('Status: active')) {
      active = true;
    } else if (trimmed.startsWith('Default: deny')) {
      defaultIncoming = 'deny';
    } else if (trimmed.startsWith('Default: allow')) {
      defaultIncoming = 'allow';
    } else if (/^\d+\s/.test(trimmed) || trimmed.includes('ALLOW') || trimmed.includes('DENY')) {
      // 尝试解析规则行: "22/tcp                     ALLOW       Anywhere"
      // 或 numbered: "[ 1] 22/tcp                     ALLOW IN    Anywhere"
      const match = trimmed.match(/^\[?\s*(\d+)\s*\]?\s+(\S+)\s+(ALLOW|DENY)\s*(IN|OUT)?\s+(\S+.*)$/);
      if (match) {
        const [, number, portProto, action, direction, fromComment] = match;
        let port = portProto, protocol = '';
        if (portProto.includes('/')) {
          [port, protocol] = portProto.split('/');
        }
        let from = fromComment;
        let comment = '';
        const commentIdx = fromComment.indexOf('#');
        if (commentIdx !== -1) {
          from = fromComment.substring(0, commentIdx).trim();
          comment = fromComment.substring(commentIdx + 1).trim();
        }
        rules.push({ number: parseInt(number), port, protocol, action, direction: direction || 'IN', from, comment });
      } else {
        // 非 numbered 格式回退
        const simpleMatch = trimmed.match(/^(\S+)\s+(ALLOW|DENY)\s*(IN|OUT)?\s+(.+)$/);
        if (simpleMatch) {
          const [, portProto, action, direction, fromComment] = simpleMatch;
          let port = portProto, protocol = '';
          if (portProto.includes('/')) {
            [port, protocol] = portProto.split('/');
          }
          let from = fromComment, comment = '';
          const ci = fromComment.indexOf('#');
          if (ci !== -1) { from = fromComment.substring(0, ci).trim(); comment = fromComment.substring(ci + 1).trim(); }
          rules.push({ number: rules.length + 1, port, protocol, action, direction: direction || 'IN', from, comment });
        }
      }
    }
  }

  return { status: active ? 'active' : 'inactive', defaultIncoming, rules };
}

// 添加规则
async function addRule({ port, protocol = 'tcp', comment = '' }) {
  const args = ['allow', `${port}/${protocol}`];
  if (comment) args.push('comment', comment);
  const { stdout, stderr } = await ufw(args);
  return { success: !stderr.includes('ERROR'), stdout, stderr };
}

// 编辑规则（按编号）—— 删旧 + 加新
async function editRule(number, { port, protocol = 'tcp', comment = '' }) {
  // 先验证新参数有效再删旧规则（减少删了加不回来的风险）
  if (!port) return { success: false, stderr: 'port is required' };

  // 删除旧规则
  const delResult = await deleteRule(number);
  if (!delResult.success) return delResult;

  // 添加新规则
  const addResult = await addRule({ port, protocol, comment });
  if (!addResult.success) {
    return { success: false, stdout: addResult.stdout, stderr: `规则已删除但新规则添加失败: ${addResult.stderr}` };
  }

  return { success: true, stdout: addResult.stdout, stderr: '' };
}

// 删除规则（按编号）
async function deleteRule(number) {
  // 需要先获取 numbered 列表来精确匹配
  const { stdout: numbered } = await ufw(['status', 'numbered']);
  const lines = numbered.split('\n');
  for (const line of lines) {
    const match = line.match(new RegExp(`^\\[\\s*${number}\\]\\s+(\\S+)\\s+ALLOW`));
    if (match) {
      const rule = match[1]; // 如 "22/tcp"
      const { stdout, stderr } = await ufw(['--force', 'delete', 'allow', rule]);
      return { success: !stderr.includes('ERROR'), stdout, stderr };
    }
  }
  // 回退：直接按编号
  const { stdout, stderr } = await ufw(['--force', 'delete', String(number)]);
  return { success: !stderr.includes('ERROR'), stdout, stderr };
}

module.exports = { getStatus, addRule, editRule, deleteRule };
