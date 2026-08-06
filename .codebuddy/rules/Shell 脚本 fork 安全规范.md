# Shell 脚本 fork 安全规范

## 一、flock 锁 fd 继承

任何使用 `flock` 的脚本,在通过 fork/exec 启动子进程(包括 `nohup` 启动的长期服务)之前,**必须关闭锁文件描述符**。该原则有两个方向，缺一不可：

### 方向 A：调用方启动子脚本前关闭锁 fd

```bash
# ❌ 错误：子进程继承 flock fd，永久持有锁
bash "$DIR/restart.sh" >> "$LOG" 2>&1

# ✅ 正确：关闭锁 fd 再启动子进程
bash "$DIR/restart.sh" 200>&- >> "$LOG" 2>&1
```

**不这样做的后果**：node server 进程持有 `/tmp/*-update.lock` 的文件描述符，所有后续 cron 调用都在 `flock -n` 处静默 `exit 0`，代码永远无法自动部署。

### 方向 B：脚本内部 `exec 9>LOCK; flock 9` 后启动服务前关闭 fd 9

```bash
LOCK_FILE=/tmp/xxx.lock
exec 9>"$LOCK_FILE"
flock 9

# ❌ 错误：nohup & 启动的长期服务继承 fd 9，脚本退出后锁不释放，
#    下一次部署 flock 9 永远等不到锁 → 调用方（deploy-agent）全局卡死
nohup uvicorn app:main --port "$PORT" > "$LOG" 2>&1 &

# ✅ 正确：9>&- 关闭 fd 9 继承（放在启动命令上，作用于子进程）
nohup uvicorn app:main --port "$PORT" 9>&- > "$LOG" 2>&1 &
```

**实际案例（2026-08-06）**：`~/quiz-app/restart.sh` 未加 `9>&-`，uvicorn 继承 fd 9 持有锁 → 新一轮部署的 `flock 9` 永久等待 → deploy-agent 卡死 1 小时 → worker.json 心跳不更新 → **所有项目（WeMonitor/WeMusic/WeDownload）部署队列被全局阻塞**。修复：启动命令加 `9>&-` + 删锁文件 + kill 卡死进程链。

## 二、环境变量子进程继承

通过 `.env` 文件传递配置给 node server 时，变量**必须 `export`**。

```bash
# ❌ 错误：局部变量，子进程不可见
GITHUB_TOKEN='ghp_xxx'

# ✅ 正确：导出为环境变量
export GITHUB_TOKEN='ghp_xxx'
```

补充：restart.sh 中需在启动 node 前 source .env：

```bash
[ -f "$DIR/.env" ] && . "$DIR/.env"
nohup node server.js > "$LOG" 2>&1 &
```

## 三、凭据不要在 .bashrc 中配置

`~/.bashrc` 仅在交互式 shell 中加载。以下场景**不会**加载 `.bashrc`：
- cron 任务
- `nohup` 启动的后台服务
- 非交互式 SSH 命令

凭据(`GITHUB_TOKEN` 等)应放在**服务的 `.env` 文件**中(受 `rsync --exclude` 保护,跨版本持久),由 restart.sh 和 update.sh 各自 source。

## 四、curl 必须设超时

所有 `curl` 调用必须加 `--max-time`(总超时)和 `--connect-timeout`(连接超时),防止 ghproxy/GitHub CDN 连接挂起导致进程永久等待、持有锁。

```bash
curl --max-time 60 --connect-timeout 15 "$URL"
```
