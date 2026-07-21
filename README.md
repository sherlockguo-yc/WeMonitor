# WeMonitor

轻量级 N150 服务器监控系统，提供系统资源监控、服务健康检查、CI/CD 部署追踪、防火墙管理、Cloudflare Tunnel 路由管理等功能。

## 技术栈

- **运行时**: Node.js + Express
- **视图引擎**: EJS + express-ejs-layouts
- **数据库**: SQLite（better-sqlite3）
- **会话**: better-sqlite3-session-store
- **系统采集**: systeminformation
- **拓扑编辑器**: React + @xyflow/react + Vite IIFE

## 快速开始

```bash
# 安装依赖
npm ci

# 启动（默认端口 18990）
npm start
```

通过环境变量配置：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `WEMONITOR_PORT` | 服务端口 | `18990` |
| `WEMONITOR_API_KEY` | API 密钥 | 内置开发密钥 |
| `GITHUB_TOKEN` | GitHub Personal Access Token（用于部署状态查询，可选） | 空 |

完整配置见 `config.js`。

## 项目结构

```
├── server.js              # 入口：启动采集器 + Web 服务器
├── config.js              # 配置中心
├── lib/
│   ├── auth.js            # 认证（登录/注册/鉴权中间件）
│   ├── db.js              # SQLite 数据库初始化
│   ├── cleaner.js         # 数据聚合与清理
│   ├── cron.js            # 定时任务管理器
│   ├── firewall.js        # 防火墙（iptables persist）管理
│   ├── tunnel.js          # Cloudflare Tunnel 状态查询
│   ├── collector/         # 数据采集器
│   │   ├── system.js      # 系统指标（CPU/内存/磁盘/网络）
│   │   ├── health.js      # 服务健康检查（TCP/HTTP）
│   │   └── scraper.js     # Pull scrape（Prometheus 指标拉取）
│   ├── api/               # API 处理器
│   │   ├── metrics.js     # 指标查询
│   │   ├── health.js      # 健康状态
│   │   ├── services.js    # 被监控服务 CRUD
│   │   ├── firewall.js    # 防火墙规则 CRUD
│   │   ├── tunnel.js      # Tunnel 路由管理
│   │   ├── cron.js        # 定时任务 API
│   │   ├── backup.js      # 备份服务状态
│   │   └── physical-topology.js  # 物理拓扑状态
│   └── deploy/            # 部署状态监控
│       ├── github.js      # GitHub Release/Actions API
│       └── local.js       # 本地运行时状态
├── routes/
│   ├── pages.js           # 页面路由（含认证控制）
│   ├── api.js             # REST API 路由
│   └── deploy.js          # 部署状态 API
├── views/                 # EJS 模板
├── public/                # 静态资源（CSS/JS）
├── topology-editor/       # 网络拓扑编辑器（React + Vite）
├── scripts/
│   ├── cron-runner.js     # 外部 cron 任务执行脚本
│   ├── restart-n150.sh    # N150 服务重启脚本
│   └── backup-r2-controller.sh  # R2 备份控制
└── data/                  # 运行时数据（SQLite DB、拓扑配置等）
```

## 功能模块

### 仪表盘

系统概览，展示 CPU、内存、磁盘、网络等关键指标的实时状态。

### 系统资源

历史系统指标查询，支持 6h / 24h / 7d 时间范围，图表展示 CPU、内存、磁盘、网络使用趋势。

### 服务状态

被监控服务的健康检查，支持 TCP 端口检测和 HTTP 健康检查，可动态增删服务。

### 定时任务

内置 cron 管理器，支持创建/编辑/启停定时任务，查看执行历史。外部 cron 任务通过 `scripts/cron-runner.js` 调用。

### CI/CD

部署状态追踪，聚合本地运行时状态 + GitHub Release/Actions 远端状态，展示各服务的当前版本、是否有更新、部署队列状态。

### 防火墙

iptables persist 规则管理，支持添加/编辑/删除 INPUT 链规则。

### Tunnel 管理

Cloudflare Tunnel 路由管理，查看 Tunnel 运行状态、添加/删除子域名路由。

### 网络拓扑

可视化物理网络拓扑编辑器（React + @xyflow/react），支持拖拽编辑节点和连线，数据持久化到 `data/topology.json`。

### 用户管理

- 注册/登录（首个注册用户自动成为 admin）
- 角色：admin（管理员）/ user（普通用户）
- 普通用户注册后需 admin 审批
- Session 有效期 7 天

## 数据采集

三类采集器以可配置间隔运行（默认 30 秒）：

| 采集器 | 说明 |
|--------|------|
| System Collector | CPU、内存、磁盘 IO、网络流量 |
| Health Collector | TCP 端口 / HTTP 端点健康检查 |
| Scraper | Pull 模式 Prometheus 指标拉取 |

原始 1 分钟粒度数据保留 7 天，1 小时聚合数据保留 30 天。

## API 概览

所有 API 需登录 + 已激活状态。

### 指标

- `GET /api/v1/stats/current` — 当前系统状态快照
- `GET /api/v1/metrics` — 历史指标查询（按时间范围和类型）
- `POST /api/v1/metrics` — Push 模式指标上报

### 服务管理

- `GET/POST /api/v1/services` — 列举/创建服务
- `PUT /api/v1/services/:id` — 更新服务
- `PATCH /api/v1/services/:id/toggle` — 启停服务
- `DELETE /api/v1/services/:id` — 删除服务

### 防火墙

- `GET /api/v1/firewall/status` — 当前规则列表
- `POST/PUT/DELETE /api/v1/firewall/rules/:number` — 规则 CRUD

### Tunnel

- `GET /api/v1/tunnel/status` — Tunnel 运行状态
- `GET /api/v1/tunnel/routes` — 路由列表
- `POST /api/v1/tunnel/route` — 添加路由
- `POST /api/v1/tunnel/restart` — 重启 Tunnel
- `GET /api/v1/tunnel/logs` — Tunnel 日志

### 部署

- `GET /api/v1/deploy/status` — 所有服务的部署状态

### 健康检查（公开）

- `GET /health` — 服务存活检查（无需鉴权）

## 部署

CI/CD 自动部署流程：`git push master → GitHub Actions 构建 → webhook 通知 N150 → deploy-agent 自动部署`。

详见 N150 部署体系文档。
