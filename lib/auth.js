const bcrypt = require('bcryptjs');
const { stmts } = require('./db');

// 鉴权中间件：未登录跳转 /login
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  // API 请求返回 401，页面请求跳转登录
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
}

// 注册
async function register(username, password) {
  if (!username || !password || username.length < 2 || password.length < 4) {
    return { error: '用户名至少 2 个字符，密码至少 4 个字符' };
  }
  const existing = stmts.getUserByUsername.get(username);
  if (existing) {
    return { error: '用户名已存在' };
  }
  const hash = await bcrypt.hash(password, 10);
  const info = stmts.createUser.run(username, hash);
  return { success: true, userId: info.lastInsertRowid };
}

// 登录
async function login(username, password) {
  const user = stmts.getUserByUsername.get(username);
  if (!user) return { error: '用户名或密码错误' };

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return { error: '用户名或密码错误' };

  return { success: true, userId: user.id, username: user.username };
}

module.exports = { requireAuth, register, login };
