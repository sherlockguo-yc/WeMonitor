// 部署状态 API — 聚合本地状态 + GitHub 远端状态

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../lib/auth');
const github = require('../lib/deploy/github');
const local = require('../lib/deploy/local');

// 被监控的服务
const SERVICES = [
  { id: 'wemonitor',  name: 'WeMonitor',  repo: 'sherlockguo-yc/WeMonitor',  dir: local.WEMONITOR_DIR,  port: 18990 },
  { id: 'wemusic',    name: 'WeMusic',    repo: 'sherlockguo-yc/WeMusic',    dir: local.WEMUSIC_DIR,    port: 5174 },
  { id: 'wedownload', name: 'WeDownload', repo: 'sherlockguo-yc/WeDownload', dir: local.WEDOWNLOAD_DIR, port: 8080 },
];

// 鉴权：需登录 + 已激活
router.use(requireAuth);
router.use((req, res, next) => {
  if (!req.session || req.session.status !== 'active') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// 计算服务整体状态：以持久化队列为准，旧事件仅作为兼容回退。
function computeSummary(localState, remote) {
  const deploy = localState.deploy;
  if (deploy && deploy.active) return 'deploying';
  if (deploy && deploy.pending) return 'queued';
  if (!localState.alive) return 'stopped';
  if (deploy && deploy.last && ['failed', 'interrupted'].includes(deploy.last.status)) return 'error';

  const last = localState.events && localState.events[localState.events.length - 1];
  if (last && last.status === 'error') return 'error';

  const rv = remote && remote.release && remote.release.version;
  const lv = localState.version;
  if (rv && lv) return rv === lv ? 'up-to-date' : 'update-available';

  return 'unknown';
}

// GET /api/v1/deploy/status
router.get('/status', async (req, res) => {
  try {
    const services = await Promise.all(SERVICES.map(async (svc) => {
      const [localState, remote] = await Promise.all([
        local.getLocalState(svc.dir, svc.port, svc.id),
        github.getRemoteState(svc.repo),
      ]);
      return {
        id: svc.id,
        name: svc.name,
        local: localState,
        remote,
        summary: computeSummary(localState, remote),
      };
    }));
    res.json({ services });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
