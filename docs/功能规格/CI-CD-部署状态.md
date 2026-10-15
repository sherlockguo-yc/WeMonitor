# WeMonitor — CI/CD 部署状态

> 状态：已实现

## 1. 功能概述

「部署状态」页面（`/deploy`）展示所有被托管服务（WeMonitor、WeMusic、WeDownload、QuizApp、WeAuto）的部署情况，包括本地版本与 GitHub 远端版本的对比、CI 构建状态、部署事件时间线、TCP 存活探测。

与 [CI/CD 持久化部署队列](CI-CD-持久化部署队列.md) 配合：队列负责执行部署，本页面负责展示部署状态。

## 2. 被监控服务

`routes/deploy.js` 中 `SERVICES` 数组定义 5 个服务：

| 服务 | 仓库 | 端口 | 部署目录 |
|------|------|------|---------|
| WeMonitor | `sherlockguo-yc/WeMonitor` | 18990 | `~/wemonitor` |
| WeMusic | `sherlockguo-yc/WeMusic` | 5174 | `~/wemusic` |
| WeDownload | `sherlockguo-yc/WeDownload` | 8080 | `~/wedownload` |
| QuizApp | `Jason-DancingBoy/quiz-app` | 9200 | `~/quiz-app` |
| WeAuto | `sherlockguo-yc/WeAuto` | 18991 | `~/weauto` |

WeAuto 自 2026-10-14 起是常驻服务（自带网站与调度器）；在此之前无监听端口，
`getLocalState()` 会跳过端口探测并把 `alive` 恒置为 `true`，即「永远显示存活」。

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
| Release | 最新 Release 的 `version`（解析 body 中 `Auto build <sha>`）、`tag`、`publishedAt`、`htmlUrl` |
| CI | Build workflow 最新一次运行的 `status`（queued / in_progress / completed）、`conclusion`、`headSha`（7 位短 SHA）、`htmlUrl` |

CI 取 run 的策略：`runs.find(r => r.name === 'Build') || runs[0]`——优先构建流程，
没有名为 `Build` 的 workflow 时退回第一条 run（此时 `headSha` 不可信，见 4.3）。
Release 与 CI 均带 `per_page=100` 分页拉取，与 `deploy-agent.sh` 保持一致。

**缓存策略**：
- Release 缓存 60s
- CI 缓存 30s
- 失败时回退到过期缓存（避免 GitHub API 限流影响页面展示）

### 3.3 状态计算

`computeSummary()` 按优先级判断。**以持久化队列为准，旧部署事件仅作为兼容回退**：

| 优先级 | 条件 | 状态 |
|--------|------|------|
| 1 | 队列 `deploy.active` | `deploying` |
| 2 | 队列 `deploy.pending` | `queued` |
| 3 | TCP 端口不通（无端口的纯 CLI 服务恒视为存活） | `stopped` |
| 4 | 队列 `deploy.last.status` ∈ `failed` / `interrupted` | `error` |
| 5 | 最后一条部署事件 status === `error`（旧事件兼容回退） | `error` |
| 6 | 本地版本 == 远端 Release 版本 | `up-to-date` |
| 7 | 本地版本 ≠ 远端 Release 版本 | `update-available` |
| 8 | 无法判断 | `unknown` |

注意：这个 `summary` 描述的是**服务整体**状态（第 5 层），不代表上游 CI/Release 各阶段的状态。
拓扑图的连线着色不使用它（4.3 的 `source` / `build` 阶段），只有 `deploy` 阶段和服务节点用它。

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

`public/js/cicd-topology.js` — SVG 绘制 5 层部署流水线，每个被监控服务一列：

```
源码 → GitHub Actions 构建 → GitHub Release → N150 部署队列 → 服务运行
```

节点与连线都按状态着色：灰色=未知/静态，绿色=成功，红色=失败，黄色=进行中。

#### 连线着色：按阶段独立判定

每条边在 `CICD_TOPOLOGY.edges` 里显式声明 `stage`，颜色由**该阶段自身的状态**决定，
而不是终点服务的整体 `summary`。若沿用 `summary`，服务仅因本地版本落后（第 5 层的事）
就会把上游 `repo→ci`、`ci→release` 一起涂黄——这是改成分阶段判定的原因。

| 阶段 | 边 | 判定 | 颜色 |
|------|----|------|------|
| `source` | 仓库 → GitHub Actions | 最近一次 Build run 已完成且 `conclusion === 'success'` | 绿 |
| `source` | | `queued` / `in_progress` | 黄 |
| `source` | | 终态失败：`failure`、`cancelled`、`timed_out`、`action_required`、`stale`、`startup_failure` | 红 |
| `source` | | `skipped` / `neutral`（已结束但不产出产物） | 黄 |
| `build` | GitHub Actions → Release | CI 成功，且 `release.version` 以 `ci.headSha` 开头（7 位短 SHA 前缀比对） | 绿 |
| `build` | | CI 成功但 Release 尚未跟上，或尚无 Release | 黄（待发布） |
| `build` | | CI 未通过 | 红 |
| `deploy` | Deploy Agent → 服务 | 沿用该服务的 `summary`（见 3.3） | 绿/黄/红 |
| 无 `stage` | Cloudflare Tunnel → Webhook、Webhook → Deploy Agent、Release → Webhook 虚线 | 信号/静态连线 | 恒定灰色 |

两个判定细节：

- `ci.headSha` 缺失时判灰（`unknown`），不伪造绿灯——数据不全时按未知展示。
- `getCI()` 在没有名为 `Build` 的 workflow 时会 fallback 取 `runs[0]`，那条 run 未必是构建流程，
  用它的 SHA 做比对会永久误报「待发布」。因此 `ci.name !== 'Build'` 时跳过比对，只验证 Release 是否存在。

#### 节点着色

- **仓库**：无入边，看远端数据是否真的有内容（`ci` 存在，或 `release.version` 非空）。
  注意 `getRemoteState()` 恒返回 `{ release, ci }` 对象，两个字段都为 `null` 时代表 GitHub 数据不可用，必须判灰。
- **GitHub Actions / Release**：取流入该节点的边的阶段状态，与连线同口径。
- **服务 / Deploy Agent**：分别取该服务的 `summary` 与全局 worker 状态。

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
