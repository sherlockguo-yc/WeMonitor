# WeMonitor — CI/CD 部署状态

> 状态：已实现

## 1. 功能概述

「部署状态」页面（`/deploy`）展示所有被托管服务（WeMonitor、WeMusic、WeDownload）的部署情况，包括本地版本与 GitHub 远端版本的对比、CI 构建状态、部署事件时间线、TCP 存活探测。

与 [CI/CD 持久化部署队列](CI-CD-持久化部署队列.md) 配合：队列负责执行部署，本页面负责展示部署状态。

## 2. 被监控服务

`routes/deploy.js` 中 `SERVICES` 数组定义 3 个服务：

| 服务 | 仓库 | 端口 | 部署目录 |
|------|------|------|---------|
| WeMonitor | `sherlockguo-yc/WeMonitor` | 18990 | `~/wemonitor` |
| WeMusic | `sherlockguo-yc/WeMusic` | 5174 | `~/wemusic` |
| WeDownload | `sherlockguo-yc/WeDownload` | 8080 | `~/wedownload` |

## 3. 状态聚合

### 3.1 本地状态

`lib/deploy/local.js` 从以下来源聚合：

| 数据源 | 内容 |
|--------|------|
| `.version` 文件 | 本地运行的 commit SHA |
| `deploy-events.jsonl` | 部署事件流（每次部署的记录） |
| `~/.deploy-queue/states/<project>.json` | 持久化部署队列的当前任务状态 |
| `~/.deploy-queue/worker.json` | 全局 worker 状态 |
| TCP 端口探测 | 服务是否存活 |

### 3.2 远端状态

`lib/deploy/github.js` 从 GitHub API 获取：

| 项目 | 内容 |
|------|------|
| Release | 最新 Release 版本号（解析 body 中 `Auto build <sha>`） |
| CI | Build workflow 最新运行状态（成功/失败/进行中） |

**缓存策略**：
- Release 缓存 60s
- CI 缓存 30s
- 失败时回退到过期缓存（避免 GitHub API 限流影响页面展示）

### 3.3 状态计算

`computeSummary()` 按优先级判断：

| 优先级 | 条件 | 状态 |
|--------|------|------|
| 1 | TCP 端口不通 | `stopped` |
| 2 | 最近部署事件 status === `error` | `error` |
| 3 | 最近部署事件 status === `started` | `deploying` |
| 4 | 本地版本 == 远端版本 | `up-to-date` |
| 5 | 本地版本 ≠ 远端版本 | `update-available` |
| 6 | 无法判断 | `unknown` |

## 4. 前端页面

### 4.1 部署状态卡片

每个服务一张卡片：
- 版本对比（本地 SHA vs 远端 SHA）
- CI 构建状态
- CD 部署状态（阶段、进度）
- 部署事件时间线（最近 N 条）

### 4.2 Worker 摘要

显示 `~/.deploy-queue/worker.json` 中的全局 worker 状态：当前是否在运行、P ID、租约信息。

### 4.3 CI/CD 拓扑图

`public/js/cicd-topology.js` — SVG 绘制 5 层部署流水线：

```
源码 → GitHub Actions 构建 → GitHub Release → N150 部署队列 → 服务运行
```

每层节点根据实际状态变色（灰色=未知，绿色=成功，红色=失败，黄色=进行中）。

### 4.4 自动刷新

30 秒轮询刷新，不重新加载页面。

## 5. API 端点

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/v1/deploy/status` | 聚合所有服务的本地+远端状态 |

## 6. 关键文件

| 文件 | 用途 |
|------|------|
| `routes/deploy.js` | 部署状态 API + 服务定义 |
| `lib/deploy/local.js` | 本地状态聚合 |
| `lib/deploy/github.js` | GitHub 远端状态查询 |
| `views/deploy.ejs` | 部署状态页面 |
| `public/js/deploy.js` | 部署页前端逻辑 |
| `public/js/cicd-topology.js` | CI/CD 拓扑图渲染 |
