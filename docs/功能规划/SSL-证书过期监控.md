# WeMonitor — SSL 证书过期监控

> 状态：规划中

## 1. 背景

域名证书过期会导致 Cloudflare Tunnel 断开、HTTPS 不可用，而证书过期往往被忽略直到服务中断。需要在过期前主动提醒。

## 2. 功能需求

### 2.1 添加域名

- 输入域名（如 `wemonitor.sherlockguo.com`）
- 自动提取证书信息：颁发者、到期时间、剩余天数、SAN 列表
- 通过 `tls.connect` 获取证书链

### 2.2 监控与告警

- 定时检查（默认每天一次）
- 阈值告警：
  - 剩余 ≤ 30 天：黄色警告
  - 剩余 ≤ 7 天：红色告警
  - 已过期：严重告警
- 记录每次检查的剩余天数，形成趋势

### 2.3 页面展示

| 域名 | 证书颁发者 | 到期时间 | 剩余天数 | 状态 |
|------|-----------|---------|---------|------|
| `wemonitor.sherlockguo.com` | Let's Encrypt | 2026-10-15 | 86 天 | ✅ |
| `wemusic.sherlockguo.com` | Let's Encrypt | 2026-10-15 | 86 天 | ✅ |

- 证书详情弹窗：SAN 列表、序列号、指纹
- 自动续期指导（Let's Encrypt certbot 续期命令）

## 3. 技术方案

### 3.1 证书获取

```js
const tls = require('tls');
const socket = tls.connect({ host: 'wemonitor.sherlockguo.com', port: 443, servername });
socket.on('secureConnect', () => {
  const cert = socket.getPeerCertificate();
  // cert.valid_to, cert.issuer, cert.subjectaltname, ...
});
```

### 3.2 存储

```sql
CREATE TABLE ssl_monitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,
  enabled INTEGER DEFAULT 1
);

CREATE TABLE ssl_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id INTEGER REFERENCES ssl_monitors(id),
  issuer TEXT,
  valid_from INTEGER,
  valid_to INTEGER,
  days_remaining INTEGER,
  sans TEXT,           -- JSON
  checked_at INTEGER
);
```

## 4. 与告警系统集成

检查完成后，如果剩余天数 ≤ 阈值，触发「系统事件」，被告警规则引擎消费后通知。

如果告警系统未实现，先独立实现：前端页面用颜色（绿/黄/红）标注。

## 5. 后续扩展

- 多域名批量管理
- 通配符证书监控
- Let's Encrypt 自动续期（调用 certbot）

## 6. API 端点

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/v1/ssl/domains` | 域名列表 + 最新状态 |
| `POST` | `/api/v1/ssl/domains` | 添加域名 |
| `DELETE` | `/api/v1/ssl/domains/:id` | 删除域名 |
| `POST` | `/api/v1/ssl/check-now` | 立即检查所有域名 |
