const bcrypt = require('bcryptjs');
const { stmts } = require('./db');

// 鉴权中间件：未登录跳转 /login
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  // 注意：路由挂载后 req.path 是子路径（如 /status），必须用 originalUrl 判断 API
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
}

// 已激活用户中间件（登录后可看，但未激活转 pending）
function requireActive(req, res, next) {
  if (!req.session || !req.session.userId) return res.redirect('/login');
  if (req.session.status !== 'active') return res.redirect('/pending');
  next();
}

// admin 中间件
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) return res.redirect('/login');
  if (req.session.status !== 'active') return res.redirect('/pending');
  if (req.session.role !== 'admin') {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Forbidden' });
    return res.status(403).send('需要管理员权限');
  }
  next();
}

// 注册
async function register(username, password) {
  if (!username || !password || username.length < 2 || password.length < 4) {
    return { error: '用户名至少 2 个字符，密码至少 4 个字符' };
  }
  const existing = stmts.getUserByUsername.get(username);
  if (existing) return { error: '用户名已存在' };

  const hash = await bcrypt.hash(password, 10);

  // 首个用户自动为 admin + active
  const { count } = stmts.countUsers.get();
  const isFirst = count === 0;
  const role = isFirst ? 'admin' : 'user';
  const status = isFirst ? 'active' : 'pending';

  const info = stmts.createUser.run(username, hash, role, status);
  return { success: true, userId: info.lastInsertRowid, role, status };
}

// 登录
async function login(username, password) {
  const user = stmts.getUserByUsername.get(username);
  if (!user) return { error: '用户名或密码错误' };

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return { error: '用户名或密码错误' };

  return { success: true, userId: user.id, username: user.username, role: user.role, status: user.status };
}

module.exports = { requireAuth, requireActive, requireAdmin, register, login };
