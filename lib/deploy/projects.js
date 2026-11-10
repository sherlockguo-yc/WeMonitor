// 被部署项目清单 — 从 N150 的 ~/.deploy-projects.conf 读取。
//
// 该文件是 N150 部署体系的单一事实来源（deploy-agent.sh 也读它），
// 因此新增服务只要在 conf 里加一行，WeMonitor 的部署监控与健康检查
// 就会自动跟上，不必再改代码里的硬编码列表（历史上正是硬编码导致漏加）。
//
// 开发机（macOS）通常没有这个文件，此时 readProjects() 返回 null，
// 调用方回退到自己内置的清单。

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONF_PATH = process.env.DEPLOY_PROJECTS_CONF
  || path.join(os.homedir(), '.deploy-projects.conf');

// conf 里的项目名是全小写，UI 需要正式显示名。
// 未列出的项目按原样显示，保证未来新增项目无需改这里。
const DISPLAY_NAMES = {
  wemonitor: 'WeMonitor',
  wemusic: 'WeMusic',
  weauto: 'WeAuto',
  wetravel: 'WeTravel',
  wefood: 'WeFood',
  wedou: 'WeDou',
};

// conf 里的目录写法有 $HOME/xxx 和 /home/user/xxx 两种
function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p.replace(/^\$HOME(?=\/|$)/, os.homedir());
}

// 解析 conf 内容（分离出来便于单测）
function parseConf(content) {
  const projects = [];
  const seen = new Set();

  for (const raw of String(content).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // 格式: PROJECT|REPO|DIR|PORT|TAG_MODE|FILE_NAME
    const parts = line.split('|');
    if (parts.length < 4) continue;

    const id = parts[0].trim();
    const repo = parts[1].trim();
    const dir = parts[2].trim();
    const port = Number.parseInt(parts[3], 10);

    if (!id || !repo || !dir || seen.has(id)) continue;
    seen.add(id);

    projects.push({
      id,
      name: DISPLAY_NAMES[id] || id,
      repo,
      dir: expandHome(dir),
      port: Number.isInteger(port) && port > 0 ? port : null,
    });
  }

  return projects;
}

// 读不到文件或文件里没有有效项目时返回 null，交由调用方回退
function readProjects() {
  try {
    const list = parseConf(fs.readFileSync(CONF_PATH, 'utf-8'));
    return list.length ? list : null;
  } catch (_) {
    return null;
  }
}

module.exports = { readProjects, parseConf, expandHome, DISPLAY_NAMES, CONF_PATH };
