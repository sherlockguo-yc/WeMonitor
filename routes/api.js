const express = require('express');
const router = express.Router();

const metricsApi = require('../lib/api/metrics');
const healthApi = require('../lib/api/health');
const servicesApi = require('../lib/api/services');
const config = require('../config');

// 鉴权中间件
function authMiddleware(req, res, next) {
  const authKey = req.headers['x-api-key'];
  if (!authKey || authKey !== config.apiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

// 系统指标
router.get('/stats/current', metricsApi.getCurrentStats);
router.get('/metrics', metricsApi.queryMetrics);
router.post('/metrics', metricsApi.pushMetrics); // 有自身的 API Key 鉴权

// 健康检查
router.get('/health', healthApi.getHealthStatus);
router.get('/health/history', healthApi.getHealthHistory);

// 服务管理（需要鉴权）
router.get('/services', servicesApi.listServices);
router.post('/services', servicesApi.createService);
router.put('/services/:id', servicesApi.updateService);
router.patch('/services/:id/toggle', servicesApi.toggleService);
router.delete('/services/:id', servicesApi.deleteService);

module.exports = router;
