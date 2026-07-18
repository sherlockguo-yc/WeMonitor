const express = require('express');
const router = express.Router();
const { requireAuth, requireActive, requireAdmin, register, login } = require('../lib/auth');

// ── 公开页面 ──

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
  req.session.role = result.role;
  req.session.status = result.status;
  res.redirect(redirect || '/');
});

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
  req.session.userId = result.userId;
  req.session.username = username;
  req.session.role = result.role;
  req.session.status = result.status;
  // 首个用户(admin)直接进系统，普通用户去等待审批
  if (result.status === 'active') return res.redirect('/');
  res.redirect('/pending');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ── 待审批页面（需登录但无需激活） ──

router.get('/pending', requireAuth, (req, res) => {
  if (req.session.status === 'active') return res.redirect('/');
  res.render('pending', { title: '等待审批', active: '', layout: false });
});

// ── 受保护页面（需登录 + 激活） ──

router.use(requireActive);

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

// Tunnel 管理
router.get('/tunnel', (req, res) => {
  res.render('tunnel', { title: 'Tunnel', active: 'tunnel' });
});

// ── 管理员页面 ──

router.use('/users', requireAdmin);
router.get('/users', (req, res) => {
  res.render('users', { title: '用户管理', active: 'users' });
});

module.exports = router;
