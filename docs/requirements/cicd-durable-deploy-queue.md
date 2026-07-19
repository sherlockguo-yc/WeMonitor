# CI/CD 持久化部署队列需求

## 1. 用户场景

当 WeMusic、WeMonitor 或 WeDownload 发布新版本时，用户在 WeMonitor 部署页需要准确看到该版本处于排队、下载、校验、同步、重启、成功或失败中的哪一步。网络波动、锁竞争和 webhook 请求超时不得让页面永久显示“部署中”。

## 2. 数据流

```text
GitHub Actions Release
  → POST /deploy
  → Webhook 校验项目与版本
  → ~/.deploy-queue/<project>.json（覆盖同项目旧待处理版本）
  → cron 每分钟启动唯一 worker
  → 读取队列、写入运行状态和事件
  → 下载 / 校验 / rsync / restart
  → 写入 succeeded 或 failed 终态
  → WeMonitor 状态 API 读取状态文件、事件和本地版本
  → 部署页每 30 秒展示状态
```

- 队列数据以项目为单位持久化在 N150，webhook 只负责入队并立即返回 `202`。
- worker 是唯一实际执行部署的组件；cron 只负责唤起 worker，不直接并发执行多个部署。
- 同一个项目在下载期间出现更高版本时，记录为 `queued`，当前任务结束后只部署最新排队版本。
- 状态文件缺失时，WeMonitor 回退到 `.version`、事件日志和端口探测；页面显示“状态未知”，不能猜测为“部署中”。

## 3. 状态机

```text
queued
  → downloading
  → verifying
  → syncing
  → restarting
  → succeeded

任意执行态
  → failed

worker 异常退出且状态超过租约
  → interrupted
  → queued（下一轮 cron 恢复）
```

状态字段至少包括：`project`、`version`、`phase`、`status`、`trigger`、`queuedAt`、`startedAt`、`updatedAt`、`finishedAt`、`workerPid`、`attempt`、`error`。

- `queued`：版本已接收，尚未获得 worker。
- `downloading`：下载进行中；页面显示已运行时长和重试次数。
- `verifying`：已下载，正在做 gzip / tar / `.version` 校验。
- `syncing`：正在 rsync 到服务目录。
- `restarting`：正在执行服务的 `restart.sh`。
- `succeeded`：部署完成，队列任务终态。
- `failed`：明确失败，保留最后错误和失败阶段。
- `interrupted`：worker PID 不存在或租约过期；下一轮 cron 必须重新入队，不得永久卡住。

`queued`、`downloading`、`verifying`、`syncing`、`restarting` 均属于页面的“部署中”，但必须显示具体阶段，不能只显示笼统文案。

## 4. 并发与调度

- 整台 N150 同一时间最多执行一个实际部署，以避免多个 Release 下载争抢带宽。
- worker 使用独立锁，但锁必须带有 PID、开始时间和租约信息；锁持有者死亡或租约过期时可自动恢复。
- cron 发现 worker 正在运行时不应静默退出：它只保持队列不变，并刷新/保留排队状态。
- webhook 不得用有 5 分钟硬超时的同步 `exec()` 等待下载完成；只写入队列。
- 不再依赖子进程继承的 flock 文件描述符维持锁，避免 webhook timeout、后台子进程与锁泄漏耦合。

## 5. 下载与失败处理

- GitHub Release 下载顺序固定为：`ghproxy.net` 镜像优先 → GitHub 直连兜底。
- 下载使用断点续传；每次失败保留已下载进度。
- 完整性校验必须使用 `gzip -t` 和解压后的 `.version`，不能只通过 `file` 检查 gzip 文件头。
- 每次失败写入结构化错误，至少区分：连接失败、HTTP 错误、下载超时、gzip 校验失败、解压失败、版本不匹配、rsync 失败、restart 失败、worker 中断。
- worker 失败后保留失败状态和错误；新版本入队时可以覆盖旧失败任务。
- `data/` 与 `.env` 继续受 rsync exclude 保护。

## 6. 影响面与风险

| 模块 | 影响 |
|---|---|
| N150 `~/deploy-agent.sh` | 从同步下载脚本改为队列 worker，影响 WeMusic、WeMonitor、WeDownload 三个项目。 |
| N150 `~/webhook-start.sh` 与 `~/wemusic/server/webhook.js` | webhook 从启动同步部署改为写队列。 |
| WeMusic `scripts/deploy-agent.sh` | 必须成为 N150 运行时脚本的受版本控制来源，防止服务器热修复与仓库代码漂移。 |
| WeMonitor `lib/deploy/local.js`、`routes/deploy.js`、前端部署页 | 读取队列状态并展示具体阶段、错误和排队情况。 |
| cron | 保持每分钟执行，但职责改为恢复/驱动唯一 worker。 |

风险等级：高。`deploy-agent.sh` 是三个服务共享基础设施；错误实现可能阻塞全部更新或误判运行状态。部署实现必须在 N150 临时目录通过 shell 语法检查、状态文件读写测试、模拟中断恢复测试后才能替换生产脚本。

## 7. 方案对比与选择

- 方案 A：保留现有结构，只补锁提示、状态和日志。改动较小，但 webhook timeout 与调度模型仍然耦合。
- 方案 B：持久化队列 + 唯一 worker + 显式状态机。改动较多，但能解决无限“部署中”、全局锁不可观测、webhook timeout 和中断恢复问题。

选择：方案 B。

## 8. 验收标准

1. WeMusic 和 WeMonitor 同时有新版本时，页面分别显示“下载中”和“排队中”，并显示项目、版本、开始时间和当前阶段。
2. 下载发生网络超时时，页面显示“下载失败”及原因；不再无限显示“部署中”。
3. webhook 请求在写入任务后快速返回 `202`；下载超过 5 分钟不会被 webhook 终止。
4. 人为终止 worker 后，下一次 cron 在租约超时后将任务显示为“已中断”并恢复为“排队中”。
5. 成功后，`.version`、队列终态、部署事件和端口探测均一致；页面显示“已是最新”。
6. Release 下载仍保持镜像优先、GitHub 直连兜底；`data/` 和 `.env` 不被 rsync 覆盖。
