const express = require('express');
const router = express.Router();

// 概览
router.get('/', (req, res) => {
  res.render('dashboard', { title: '概览', active: 'dashboard' });
});

// 系统资源
router.get('/system', (req, res) => {
  res.render('system', { title: '系统资源', active: 'system' });
});

// 服务状态
router.get('/services', (req, res) => {
  res.render('services', { title: '服务状态', active: 'services' });
});

// 服务管理
router.get('/settings', (req, res) => {
  res.render('settings', { title: '服务管理', active: 'settings' });
});

module.exports = router;
