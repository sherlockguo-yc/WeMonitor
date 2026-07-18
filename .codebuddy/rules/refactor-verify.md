# 重构后验证

## 规则

修改 `server.js`、路由文件、或注入新中间件后，**必须验证原有关键中间件仍生效**，至少检查：
- 布局引擎（如 `express-ejs-layouts`）未丢失
- Session / 认证中间件未被覆盖
- 静态文件路由未被新路由吞掉

验证方法：修改后本地启动服务，访问关键页面确认渲染完整。

## 背景

WeMonitor 加鉴权重构 `server.js` 时漏掉了 `app.use(expressLayouts)` 和 `app.set('layout', 'layout')`，导致所有页面无侧栏无样式。
