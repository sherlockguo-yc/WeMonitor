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
// 启动后 5 秒执行一次
setTimeout(() => cleaner.run(), 5000);

// ── 启动 Web 服务器 ──

const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const path = require('path');

const app = express();

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// Session
app.use(session({
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

// 路由
app.use('/api/v1', require('./routes/api'));
app.use('/', require('./routes/pages'));

// 健康检查 endpoint（给外部探测用）
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`[WeMonitor] Server running on http://0.0.0.0:${config.port}`);
});
