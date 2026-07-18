// 本地部署状态读取 — .version 文件、deploy-events.jsonl 事件、TCP 端口探测

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

// WeMonitor 自身运行目录（项目根，含 .version 和 data/）
const WEMONITOR_DIR = path.join(__dirname, '..', '..');
// WeMusic 运行目录（N150 上为 ~/wemusic）
const WEMUSIC_DIR = path.join(os.homedir(), 'wemusic');
// WeDownload 运行目录（N150 上为 ~/wedownload）
const WEDOWNLOAD_DIR = path.join(os.homedir(), 'wedownload');

// 读取 .version 文件（短 SHA）
function readVersion(dir) {
  try {
    return fs.readFileSync(path.join(dir, '.version'), 'utf-8').trim();
  } catch (_) {
    return null;
  }
}

// 读取部署事件（最后 maxLines 行，逐行解析 JSON）
function readEvents(dir, maxLines = 20) {
  try {
    const content = fs.readFileSync(path.join(dir, 'data', 'deploy-events.jsonl'), 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines
      .slice(-maxLines)
      .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

// TCP 端口探测：能否连上 → 服务是否运行
function probePort(port, host = '127.0.0.1', timeout = 1000) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(r);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

// 聚合本地状态
async function getLocalState(dir, port) {
  const alive = await probePort(port);
  return {
    version: readVersion(dir),
    events: readEvents(dir),
    alive,
  };
}

module.exports = {
  WEMONITOR_DIR,
  WEMUSIC_DIR,
  WEDOWNLOAD_DIR,
  getLocalState,
  readVersion,
  readEvents,
  probePort,
};
