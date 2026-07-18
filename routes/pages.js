const express = require('express');
const router = express.Router();
const { requireAuth, register, login } = require('../lib/auth');

// ── 公开页面 ──

// 登录页
router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: '', redirect: req.query.redirect || '/', layout: false, isRegister: false });
});

router.post('/login', async (req, res) => {
  const { username, password, redirect } = req.body;
  const result = await login(username, password);
  if (result.error) {
    return res.render('login', { error: result.error, redirect: redirect || '/', layout: false, isRegister: false });
  }
  req.session.userId = result.userId;
  req.session.username = result.username;
  res.redirect(redirect || '/');
});

// 注册
router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: '', redirect: '/', layout: false, isRegister: true });
});

router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const result = await register(username, password);
  if (result.error) {
    return res.render('login', { error: result.error, redirect: '/', layout: false, isRegister: true });
  }
  // 注册成功，自动登录
  req.session.userId = result.userId;
  req.session.username = username;
  res.redirect('/');
});

// 退出
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ── 受保护页面 ──

router.use(requireAuth);

router.get('/', (req, res) => {
  res.render('dashboard', { title: '概览', active: 'dashboard' });
});

router.get('/system', (req, res) => {
  res.render('system', { title: '系统资源', active: 'system' });
});

router.get('/services', (req, res) => {
  res.render('services', { title: '服务状态', active: 'services' });
});

router.get('/settings', (req, res) => {
  res.render('settings', { title: '服务管理', active: 'settings' });
});

router.get('/firewall', (req, res) => {
  res.render('firewall', { title: '防火墙', active: 'firewall' });
});

module.exports = router;
