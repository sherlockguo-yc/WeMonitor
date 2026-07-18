# WeMonitor Phase 1 需求文档

> 创建时间：2026-07-18
> 状态：已确认

## 1. 项目概述

WeMonitor 是一个独立部署的轻量级监控系统，Phase 1 目标：监控 N150 小主机服务器的系统资源与 WeMusic 应用指标，提供 Web Dashboard 可视化。

**核心原则**：一个 Node.js 进程搞定所有事，无需外部组件依赖，资源占用 < 200MB。

## 2. 架构概览

```
┌─────────────────────────────────────────────┐
│                 N150 小主机                    │
│                                               │
│  ┌─────────────────────────────────────────┐ │
│  │           WeMonitor（Node.js）            │ │
│  │                                          │ │
│  │  ┌──────────┐  ┌──────────┐             │ │
│  │  │ 系统采集器 │  │ 健康检查  │             │ │
│  │  └─────┬────┘  └─────┬────┘             │ │
│  │        │              │                   │ │
│  │        ▼              ▼                   │ │
│  │  ┌──────────────────────────┐            │ │
│  │  │         SQLite            │            │ │
│  │  └──────────────────────────┘            │ │
│  │        ▲              ▲                   │ │
│  │        │              │                   │ │
│  │  ┌─────┴────┐  ┌─────┴────┐             │ │
│  │  │ Pull 拉取 │  │ Push 接收 │             │ │
│  │  └─────┬────┘  └─────┬────┘             │ │
│  │        │              │                   │ │
│  │        ▼              ▼                   │ │
│  │  ┌──────────┐  ┌──────────┐             │ │
│  │  │ REST API  │  │ Web 页面  │             │ │
│  │  └──────────┘  └──────────┘             │ │
│  └─────────────────────────────────────────┘ │
│                                               │
│  ┌──────────┐                                │
│  │  WeMusic  │ ── /metrics ──► Pull 拉取     │
│  └──────────┘                                │
│                                               │
│  ┌──────────┐                                │
│  │  其他服务  │ ── POST /api/v1/metrics ──►   │
│  │（定时脚本）│    Push 上报                   │
│  └──────────┘                                │
└─────────────────────────────────────────────┘
```

### 2.1 数据流

| 方向 | 触发方 | 协议 | 说明 |
|------|--------|------|------|
| Pull | WeMonitor → WeMusic | HTTP GET `/metrics` | 定时 scrape 应用暴露的 Prometheus 格式指标 |
| Push | 外部服务 → WeMonitor | HTTP POST `/api/v1/metrics` | 批量 JSON 上报，适用于短期任务/脚本 |
| 系统自采 | WeMonitor 内部 | systeminformation 库 | 定时采集 CPU/内存/磁盘/网络 |

## 3. 数据采集设计

### 3.1 系统指标（自采集）

| 指标类别 | 具体指标 | 采集频率 | 存储粒度 |
|----------|---------|---------|---------|
| CPU | 使用率（%）、各核心负载 | 30 秒 | 保留 1 分钟平均值 |
| 内存 | 总量/已用/可用（GB）、使用率（%） | 30 秒 | 保留 1 分钟平均值 |
| 磁盘 | 各分区总量/已用/可用、使用率（%）、I/O | 60 秒 | 保留 1 分钟值 |
| 网络 | 入/出流量（KB/s）、连接数 | 60 秒 | 保留 1 分钟值 |
| 系统信息 | 运行时间、负载均值（1/5/15min）、温度 | 60 秒 | 保留 1 分钟值 |

### 3.2 服务健康检查（定时探测）

| 检查项 | 方式 | 频率 | 判定标准 |
|--------|------|------|---------|
| WeMusic 存活 | TCP 端口探测（你的非标端口如 8443） | 30 秒 | 端口可达 = 健康 |
| 自定义进程存活 | 进程名匹配 | 30 秒 | 进程存在 = 健康 |

服务健康状态模型：`healthy` / `degraded`（延迟过高）/ `unhealthy`（不可达）。

### 3.3 应用指标（Pull 模式）

WeMusic 应用需集成 `prom-client`，暴露 `/metrics` endpoint。WeMonitor 定时 scrape。

WeMusic 需暴露的核心指标（MV P先做最关键的几项）：

| 指标 | 类型 | 说明 |
|------|------|------|
| `wemusic_http_requests_total` | Counter | 各端点请求总数 |
| `wemusic_http_request_duration_ms` | Histogram | 请求延迟分布 |
| `wemusic_play_count_total` | Counter | 播放总数 |
| `wemusic_active_connections` | Gauge | 当前活跃连接数 |

### 3.4 应用指标（Push 模式）

外部服务/脚本通过调用 WeMonitor API 上报指标。

**接口**：`POST /api/v1/metrics`

**请求体**：
```json
{
  "service": "backup-script",
  "metrics": [
    { "name": "backup_duration_seconds", "value": 42.3, "labels": { "target": "music_db" } },
    { "name": "backup_size_bytes", "value": 1048576, "labels": { "target": "music_db" } },
    { "name": "backup_success", "value": 1 }
  ]
}
```

**鉴权**：MVP 阶段使用 API Key（`X-API-Key` header），在 WeMonitor 启动时配置。

## 4. 数据存储设计

### 4.1 时序数据表

```sql
CREATE TABLE metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT NOT NULL,          -- 服务名：system / wemusic / backup-script
  metric_name TEXT NOT NULL,      -- 指标名
  labels TEXT DEFAULT '{}',       -- 标签 JSON
  value REAL NOT NULL,            -- 指标值
  timestamp INTEGER NOT NULL      -- Unix 时间戳（毫秒）
);
CREATE INDEX idx_metrics_lookup ON metrics(service, metric_name, timestamp);
```

### 4.2 配置表

```sql
CREATE TABLE services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,      -- 服务名
  scrape_url TEXT,                -- Pull 模式的 metrics URL（为空则为 Push 模式）
  scrape_interval INTEGER DEFAULT 30, -- Pull 间隔（秒）
  health_check_type TEXT,         -- tcp_port / process
  health_check_target TEXT,       -- 端口号或进程名
  enabled INTEGER DEFAULT 1
);
```

### 4.3 健康检查历史

```sql
CREATE TABLE health_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER REFERENCES services(id),
  status TEXT NOT NULL,           -- healthy / degraded / unhealthy
  latency_ms INTEGER,             -- 探测延迟
  message TEXT,                   -- 错误信息
  timestamp INTEGER NOT NULL
);
```

### 4.4 数据保留策略

- 1 分钟粒度数据：保留 7 天
- 1 小时粒度聚合数据：保留 30 天
- 清理任务：定时任务每小时执行一次

## 5. API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/metrics` | 查询指标数据（支持 service / metric_name / 时间范围筛选） |
| `POST` | `/api/v1/metrics` | Push 上报指标（需要 API Key） |
| `GET` | `/api/v1/health` | 获取各服务最新健康状态 |
| `GET` | `/api/v1/health/history` | 获取某服务的健康检查历史 |
| `GET` | `/api/v1/services` | 获取已注册服务列表 |
| `POST` | `/api/v1/services` | 注册新服务 |
| `GET` | `/api/v1/stats/current` | 获取当前实时系统状态（CPU/内存/磁盘/网络） |

## 6. 前端页面结构

采用后台管理风格：左侧导航菜单 + 右侧内容区。

### 6.1 页面结构

```
┌──────────────┬──────────────────────────────────┐
│   导航菜单    │          内容区域                  │
│              │                                   │
│  📊 概览     │  当前选中页面的内容                  │
│  💻 系统资源  │                                   │
│  📡 服务状态  │                                   │
│  ⚙️  服务管理  │                                   │
│              │                                   │
└──────────────┴──────────────────────────────────┘
```

### 6.2 各页面内容

**概览（Dashboard）**：
- 系统资源实时仪表盘：CPU / 内存 / 磁盘的当前值和迷你趋势图
- 服务健康状态卡片：每个服务有红/黄/绿指示灯
- 告警预留区（Phase 2 实现）

**系统资源**：
- CPU 使用率趋势图（1小时/6小时/24小时/7天可选）
- 内存使用趋势图
- 磁盘使用趋势图（各分区）
- 网络流量趋势图

**服务状态**：
- 服务列表：名称、健康状态、上次检查时间、延迟
- 点击某个服务 → 展示其 Pull/Push 指标的趋势图
- 健康检查历史时间线

**服务管理**：
- 已注册服务表格
- 新增服务表单（名称、Pull URL 或 Push 模式、健康检查配置）
- 编辑/启用/禁用服务

### 6.3 前端技术

| 层面 | 技术 |
|------|------|
| 模板引擎 | EJS（服务端渲染页面框架） |
| 图表 | Chart.js（CDN 引入） |
| 样式 | 纯 CSS（CSS 变量体系，遵循前端开发规范） |
| 图标 | Lucide（CDN 引入） |
| 数据获取 | 原生 `fetch()` → 更新图表和 DOM |
| 刷新方式 | 页面内「刷新」按钮，仅重新 fetch 数据，不刷新页面 |

## 7. 技术栈总览

| 层面 | 选型 | 理由 |
|------|------|------|
| 运行时 | Node.js 20+ | 与 WeMusic 同技术栈 |
| 框架 | Express | 轻量，成熟 |
| 数据库 | better-sqlite3 | 同步 API，零配置，适合单进程场景 |
| 系统指标 | systeminformation | 跨平台系统信息库 |
| 模板引擎 | EJS | JS 原生语法，无学习成本 |
| 图表 | Chart.js CDN | 主流，轻量 |
| 图标 | Lucide CDN | 与 WeMusic 图标库统一 |
| 进程管理 | PM2（可选） | N150 上保证进程存活 |

## 8. 文件结构

```
WeMonitor/
├── server.js                  # 入口：启动采集 + API + 静态文件
├── package.json
├── config.js                  # 配置文件（端口、API Key、数据保留天数等）
├── lib/
│   ├── db.js                  # SQLite 封装
│   ├── collector/
│   │   ├── system.js          # 系统指标采集
│   │   ├── health.js          # 健康检查
│   │   └── scraper.js         # Pull 模式 scrape
│   ├── api/
│   │   ├── metrics.js         # 指标查询/上报 API
│   │   ├── health.js          # 健康状态 API
│   │   └── services.js        # 服务管理 API
│   └── cleaner.js             # 数据清理定时任务
├── routes/
│   ├── api.js                 # API 路由
│   └── pages.js               # 页面路由
├── views/
│   ├── layout.ejs             # 布局框架（左侧菜单 + 右侧内容区）
│   ├── dashboard.ejs          # 概览页
│   ├── system.ejs             # 系统资源页
│   ├── services.ejs           # 服务状态页
│   └── settings.ejs           # 服务管理页
├── public/
│   ├── css/
│   │   └── style.css          # 全局样式
│   └── js/
│       ├── dashboard.js       # 概览页图表逻辑
│       ├── system.js          # 系统资源页图表逻辑
│       ├── services.js        # 服务状态页逻辑
│       └── settings.js        # 服务管理页逻辑
└── docs/
    └── requirements-phas1.md  # 本文档
```

## 9. Phase 1 不包含的功能

以下功能明确推迟到后续迭代：

- ❌ 告警通知（企微/邮件等）
- ❌ 多租户架构
- ❌ 日志采集（Loki + Promtail）
- ❌ 链路追踪（OpenTelemetry）
- ❌ 用户认证与权限
- ❌ Grafana 集成
- ❌ 对外开放 API（API Key 仅做基本鉴权）
- ❌ 数据导出

## 10. 已确认项

- [x] N150 上先只监控 WeMusic，未来再加新服务
- [x] WeMusic 主服务端口：5174（HTTP），Webhook 服务端口：9001（HTTP）
  - 健康检查：TCP 探测 5174 端口，30 秒一次
  - Webhook 服务 9001 可后续再加
- [x] WeMonitor 自身监听端口：**18990**
