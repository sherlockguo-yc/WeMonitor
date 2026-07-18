const config = require('./config');
const { db } = require('./lib/db');
const systemCollector = require('./lib/collector/system');
const healthCollector = require('./lib/collector/health');
const scraper = require('./lib/collector/scraper');
const cleaner = require('./lib/cleaner');

// ── 启动采集器 ──

console.log('[WeMonitor] Starting collectors...');

// 系统指标采集（首次立即执行一次）
systemCollector.collect().then(rows => {
  console.log(`[collector] system: ${rows.length} metrics collected`);
}).catch(err => {
  console.error('[collector] system initial error:', err.message);
});
setInterval(() => {
  systemCollector.collect().catch(err => {
    console.error('[collector] system error:', err.message);
  });
}, config.systemInterval * 1000);

// 健康检查
healthCollector.checkAll().then(results => {
  console.log(`[collector] health: ${results.length} services checked`);
}).catch(err => {
  console.error('[collector] health initial error:', err.message);
});
setInterval(() => {
  healthCollector.checkAll().catch(err => {
    console.error('[collector] health error:', err.message);
  });
}, config.healthInterval * 1000);

// Pull scrape
scraper.scrapeAll().then(results => {
  for (const r of results) {
    console.log(`[collector] scrape ${r.service}: ${r.count} metrics`);
  }
}).catch(err => {
  console.error('[collector] scraper initial error:', err.message);
});
setInterval(() => {
  scraper.scrapeAll().catch(err => {
    console.error('[collector] scraper error:', err.message);
  });
}, config.scrapeInterval * 1000);

// 数据清理（每小时）
setInterval(() => {
  cleaner.run();
}, 3600000);
// 启动 5 秒后：先全量补齐历史 hour_ts，再跑一次常规清理
setTimeout(() => {
  cleaner.runFull();
  setTimeout(() => cleaner.run(), 1000);
}, 5000);

// ── 启动 Web 服务器 ──

const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const path = require('path');
const fs = require('fs');
const version = (() => {
  try { return fs.readFileSync(path.join(__dirname, '.version'), 'utf-8').trim(); }
  catch (_) { return 'dev'; }
})();

// 部署时间（.version 文件的 mtime）
let deployedAt = '';
try {
  const verPath = path.join(__dirname, '.version');
  deployedAt = new Date(fs.statSync(verPath).mtimeMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
} catch (_) { deployedAt = '未知'; }

const app = express();

// 性能日志中间件（记录每个请求耗时）
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (ms > 100) console.log(`[perf] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
// 静态文件 — 生产环境用长缓存，CSS/JS 文件名不变时会走浏览器缓存
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  }
}));

// Session
app.use(session({
  store: new SqliteStore({ client: db }),
  secret: config.sessionSecret || 'wemonitor-session-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 天
  }
}));

// 视图引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// 将 session 和版本号暴露给所有模板（必须在 layout 中间件之后）
app.use((req, res, next) => {
  res.locals.session = req.session;
  res.locals.version = version;
  res.locals.deployedAt = deployedAt;
  next();
});

// 健康检查 — 放在鉴权路由之前
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// 路由
app.use('/api/v1/deploy', require('./routes/deploy'));
app.use('/api/v1', require('./routes/api'));
app.use('/', require('./routes/pages'));

app.listen(config.port, '0.0.0.0', () => {
  console.log(`[WeMonitor] Server running on http://0.0.0.0:${config.port}`);
});
