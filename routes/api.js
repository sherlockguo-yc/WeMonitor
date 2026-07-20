const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../lib/auth');
const { stmts } = require('../lib/db');

const metricsApi = require('../lib/api/metrics');
const healthApi = require('../lib/api/health');
const servicesApi = require('../lib/api/services');
const firewallApi = require('../lib/api/firewall');

// 所有 API 需要鉴权 + 已激活
router.use(requireAuth);
router.use((req, res, next) => {
  if (!req.session || req.session.status !== 'active') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// 系统指标
router.get('/stats/current', metricsApi.getCurrentStats);
router.get('/metrics', metricsApi.queryMetrics);
router.get('/metrics/batch', metricsApi.queryMetricsBatch);
router.post('/metrics', metricsApi.pushMetrics);

// 健康检查
router.get('/health', healthApi.getHealthStatus);

// 服务管理
router.get('/services', servicesApi.listServices);
router.post('/services', servicesApi.createService);
router.put('/services/:id', servicesApi.updateService);
router.patch('/services/:id/toggle', servicesApi.toggleService);
router.delete('/services/:id', servicesApi.deleteService);

// 防火墙管理
router.get('/firewall/status', firewallApi.getStatus);
router.post('/firewall/rules', firewallApi.addRule);
router.put('/firewall/rules/:number', firewallApi.editRule);
router.delete('/firewall/rules/:number', firewallApi.deleteRule);

// Tunnel 管理
const tunnelApi = require('../lib/api/tunnel');
router.get('/tunnel/status', tunnelApi.getStatus);
router.post('/tunnel/restart', tunnelApi.restart);
router.get('/tunnel/logs', tunnelApi.getLogs);
router.post('/tunnel/route', tunnelApi.addRoute);
router.get('/tunnel/routes', tunnelApi.getRoutes);

// 物理拓扑
const physicalTopologyApi = require('../lib/api/physical-topology');
router.get('/physical-topology', physicalTopologyApi.getStatus);

// 拓扑画板配置
const fs = require('fs');
const path = require('path');
const TOPO_CONFIG = path.join(__dirname, '..', 'data', 'topology.json');
const TOPO_DEFAULT = path.join(__dirname, '..', 'lib', 'default-topology.json');

function readTopoConfig() {
  if (!fs.existsSync(TOPO_CONFIG)) {
    // 首次：从默认配置复制
    const dir = path.dirname(TOPO_CONFIG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(TOPO_DEFAULT, TOPO_CONFIG);
  }
  return JSON.parse(fs.readFileSync(TOPO_CONFIG, 'utf-8'));
}

router.get('/topology-config', (req, res) => {
  try {
    res.json(readTopoConfig());
  } catch (err) {
    res.status(500).json({ error: '读取拓扑配置失败' });
  }
});

router.post('/topology-config', (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.nodes || !data.edges) {
      return res.status(400).json({ error: '数据格式无效：需要 nodes 和 edges' });
    }
    fs.writeFileSync(TOPO_CONFIG, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: '保存拓扑配置失败: ' + err.message });
  }
});

// ── 数据备份管理 ──
const backupApi = require('../lib/api/backup');
router.get('/backup/services', backupApi.listBackupServices);
router.patch('/backup/services/:name/toggle', backupApi.toggleBackup);
// ── 定时任务管理 ──
const cronApi = require('../lib/api/cron');
router.get('/cron/jobs', cronApi.listJobs);
router.post('/cron/jobs', cronApi.createJob);
router.put('/cron/jobs/:id', cronApi.updateJob);
router.delete('/cron/jobs/:id', cronApi.deleteJob);
router.post('/cron/jobs/:id/toggle', cronApi.toggleJob);
router.get('/cron/jobs/:id/history', cronApi.getHistory);
router.post('/cron/sync', cronApi.forceSync);
router.get('/cron/sync-status', cronApi.syncStatus);

// ── 管理员 API ──
router.use('/admin', requireAdmin);

router.get('/admin/users', (req, res) => {
  const users = stmts.getAllUsers.all();
  // 不返回 password_hash
  res.json({ users: users.map(u => ({ id: u.id, username: u.username, role: u.role, status: u.status, created_at: u.created_at })) });
});

router.post('/admin/users/:id/approve', (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const user = stmts.getUserById.get(userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  stmts.approveUser.run(userId);
  res.json({ approved: true });
});

router.put('/admin/users/:id/role', (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { role } = req.body;
  if (!role || !['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: '无效的角色' });
  }
  const user = stmts.getUserById.get(userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.id === req.session.userId) return res.status(400).json({ error: '不能修改自己的角色' });
  // 不允许将最后一个管理员降级
  if (user.role === 'admin' && role === 'user') {
    const allUsers = stmts.getAllUsers.all();
    const adminCount = allUsers.filter(u => u.role === 'admin' && u.id !== userId).length;
    if (adminCount === 0) return res.status(400).json({ error: '不能取消最后一个管理员' });
  }
  stmts.setRole.run(role, userId);
  res.json({ updated: true, role });
});

router.delete('/admin/users/:id', (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const user = stmts.getUserById.get(userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  // 不允许删除自己
  if (user.id === req.session.userId) return res.status(400).json({ error: '不能删除自己' });
  // 不允许删除最后一个 admin
  if (user.role === 'admin') {
    const allUsers = stmts.getAllUsers.all();
    const adminCount = allUsers.filter(u => u.role === 'admin' && u.id !== userId).length;
    if (adminCount === 0) return res.status(400).json({ error: '不能删除最后一个管理员' });
  }
  stmts.deleteUser.run(userId);
  res.json({ deleted: true });
});

module.exports = router;
