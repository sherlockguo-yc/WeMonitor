# WeMonitor — Tunnel 管理

> 状态：已实现

## 1. 功能概述

通过 Web 界面管理 N150 上运行的 Cloudflare Tunnel（cloudflared），支持查看运行状态、管理子域名路由、查看日志、远程重启。

## 2. 核心设计

### 2.1 单一数据源

**子域名路由的唯一数据源是 Cloudflare Dashboard API**（`GET /client/v4/accounts/:id/cfd_tunnel/:id/configurations`），不从本地 `/etc/cloudflared/config.yml` 读取。

理由：所有路由变更在 Cloudflare Dashboard 操作，本地 config.yml 仅保留连接凭证（`tunnel:` + `credentials-file:` 两行），ingress 段已清空。单一数据源避免本地配置与 Dashboard 不一致。

### 2.2 API 认证

使用 Cloudflare API Token（环境变量 `CF_API_TOKEN`），权限：`Cloudflare Tunnel: Edit`。

Token 通过 N150 上的 `.env` 文件配置，`restart.sh` 在启动时加载。

## 3. 功能

### 3.1 运行状态

并行查询：
- `systemctl status cloudflared` → 运行中/停止、PID、运行时间
- `cloudflared tunnel info` → 连接数、边缘节点位置

前端展示：Tunnel 名称、连接状态、活跃连接数、边缘节点、运行时长。

30 秒内存缓存避免重复调用慢速 CLI 命令。

### 3.2 子域名路由

#### 查看路由列表

从 Cloudflare API 实时拉取 ingress 配置，解析为表格：
- 域名（hostname）
- 目标服务（service URL）
- 协议类型（HTTP / SSH 等非 HTTP）

#### 添加路由

两步操作：
1. `cloudflared tunnel route dns` → 创建 DNS CNAME 记录
2. Cloudflare API PUT → 更新 ingress 配置（插入到 404 catch-all 规则之前）

添加表单支持：
- 预设服务下拉（WeMusic、WeMonitor、WeDownload、Webhook 等）
- 自定义目标地址

### 3.3 日志查看

调用 `sudo journalctl -u cloudflared` 获取最近日志。

### 3.4 远程重启

`POST /api/v1/tunnel/restart` → `sudo systemctl restart cloudflared`。

## 4. API 端点

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/v1/tunnel/status` | Tunnel 运行状态 |
| `POST` | `/api/v1/tunnel/restart` | 重启 Tunnel |
| `GET` | `/api/v1/tunnel/logs` | Tunnel 日志 |
| `GET` | `/api/v1/tunnel/routes` | 路由列表（Cloudflare API） |
| `POST` | `/api/v1/tunnel/route` | 添加路由（DNS + ingress） |

## 5. 当前路由

| 域名 | 本地端口 | 服务 |
|------|---------|------|
| `wemusic.sherlockguo.com` | `:5174` | WeMusic |
| `wemusic.sherlockguo.com`/deploy `/webhook` `/health` | `:9001` | WeMusic Webhook |
| `wemonitor.sherlockguo.com` | `:18990` | WeMonitor |
| `wedownload.sherlockguo.com` | `:8080` | WeDownload |
| `aria.sherlockguo.com` | `:6801` | Aria2 |

所有服务共用同一个 Tunnel。

## 6. 关键文件

| 文件 | 用途 |
|------|------|
| `lib/tunnel.js` | Tunnel 管理（status/restart/logs/routes） |
| `views/tunnel.ejs` | Tunnel 管理页面 |
| `public/js/tunnel.js` | 前端交互逻辑 |
