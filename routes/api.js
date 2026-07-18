const express = require('express');
const router = express.Router();
const { requireAuth } = require('../lib/auth');

const metricsApi = require('../lib/api/metrics');
const healthApi = require('../lib/api/health');
const servicesApi = require('../lib/api/services');
const firewallApi = require('../lib/api/firewall');
const config = require('../config');

// 所有 API 需要鉴权（除了 health check）
router.use((req, res, next) => {
  if (req.path === '/health') return next(); // 健康检查不需要鉴权
  requireAuth(req, res, next);
});

// 系统指标
router.get('/stats/current', metricsApi.getCurrentStats);
router.get('/metrics', metricsApi.queryMetrics);
router.post('/metrics', metricsApi.pushMetrics);

// 健康检查
router.get('/health', healthApi.getHealthStatus);
router.get('/health/history', healthApi.getHealthHistory);

// 服务管理
router.get('/services', servicesApi.listServices);
router.post('/services', servicesApi.createService);
router.put('/services/:id', servicesApi.updateService);
router.patch('/services/:id/toggle', servicesApi.toggleService);
router.delete('/services/:id', servicesApi.deleteService);

// 防火墙管理
router.get('/firewall/status', firewallApi.getStatus);
router.post('/firewall/rules', firewallApi.addRule);
router.delete('/firewall/rules/:number', firewallApi.deleteRule);

module.exports = router;
