#!/bin/bash
# WeMonitor 重启脚本（N150 生产环境，随 CI 产物一起分发）
PORT=18990
LOG=/tmp/wemonitor.log
DIR="$HOME/wemonitor"
EVENTS="$DIR/data/deploy-events.jsonl"
DEPS_DIR="$HOME/wemonitor-deps"
LOCK_FILE=/tmp/wemonitor-restart.lock

# 同一时刻只允许一个 restart.sh 执行：cron 健康检查与 webhook 部署会并发触发，
# 而依赖安装可能持续数分钟，并发跑会互相踩坏 node_modules。
#
# 锁必须在拉起常驻服务时显式关闭（9>&-）：常驻进程若继承 fd 9 就会永久持有锁，
# 之后每一次部署都卡死在 flock 上（2026-10-13 在别的项目上踩过这个坑）。
exec 9>"$LOCK_FILE"
flock 9
echo "[$(date)] 已获得部署锁 $LOCK_FILE"

log_event() {
  local stage="$1" status="$2" message="$3"
  local ts=$(date +%s)
  mkdir -p "$DIR/data"
  echo "{\"stage\":\"$stage\",\"status\":\"$status\",\"message\":\"$message\",\"ts\":$ts}" >> "$EVENTS"
}

# 读取当前部署版本
VER=$(cat "$DIR/.version" 2>/dev/null || echo "unknown")

# ── 准备运行时依赖 ────────────────────────────────────────────────
# 依赖装在部署目录之外：deploy-agent 用 rsync -a --delete 同步 $DIR，
# 包里没有的东西都会被清掉（node_modules 也不例外），所以不能放在 $DIR 下。
# 只有 package-lock.json 变化时才重装；未变化时实测 0.3 秒跳过。
DEPS_MARKER="$DEPS_DIR/.lock-hash"

if [ -x /usr/local/bin/npm ]; then
  NPM=/usr/local/bin/npm
else
  NPM="$(command -v npm || echo npm)"
fi

ensure_deps() {
  local want
  want=$(sha1sum "$DIR/package-lock.json" 2>/dev/null | cut -d' ' -f1)
  if [ -z "$want" ]; then
    echo "[$(date)] ✗ 缺少 package-lock.json，无法安装依赖"
    log_event "deps" "error" "缺少 package-lock.json，未重启 (v $VER)"
    return 1
  fi

  mkdir -p "$DEPS_DIR"
  if [ "$(cat "$DEPS_MARKER" 2>/dev/null)" = "$want" ] && [ -d "$DEPS_DIR/node_modules" ]; then
    echo "[$(date)] 依赖未变更，跳过安装"
  else
    cp "$DIR/package.json" "$DIR/package-lock.json" "$DEPS_DIR/"
    echo "[$(date)] 安装依赖到 $DEPS_DIR（npmmirror + 本地缓存优先，首次约 2 分钟）…"
    log_event "deps" "started" "安装依赖到 $DEPS_DIR (v $VER)"
    # N150 在大陆，npm 官方源直连很慢；--prefer-offline 命中 ~/.npm 缓存可降到秒级
    if ! (cd "$DEPS_DIR" && "$NPM" install --omit=dev --prefer-offline --no-audit --no-fund \
        --registry=https://registry.npmmirror.com); then
      echo "[$(date)] ✗ 依赖安装失败"
      log_event "deps" "error" "依赖安装失败，未重启 (v $VER)"
      return 1
    fi
    printf '%s' "$want" > "$DEPS_MARKER"
  fi

  # rsync --delete 每轮都会清掉部署目录里的 node_modules，用软链接接回去
  if [ -e "$DIR/node_modules" ] && [ ! -L "$DIR/node_modules" ]; then
    rm -rf "$DIR/node_modules"
  fi
  ln -sfn "$DEPS_DIR/node_modules" "$DIR/node_modules"
  echo "[$(date)] 依赖就绪：$DIR/node_modules -> $DEPS_DIR/node_modules"
  return 0
}

# 装在停进程之前：安装期间旧版本仍在提供服务，cron 健康检查不会插进来重启
if ! ensure_deps; then
  echo "[$(date)] ✗ 依赖准备失败，保持旧版本继续运行（不重启）"
  exit 1
fi

# 杀旧进程
PID=$(lsof -ti:$PORT 2>/dev/null)
if [ -n "$PID" ]; then
  kill $PID 2>/dev/null
  sleep 1
  kill -9 $PID 2>/dev/null
  echo "[$(date)] stopped PID $PID"
  log_event "restart" "ok" "已停止旧进程 PID $PID"
fi

# 启动
cd "$DIR" || exit 1
# 统一凭据（GITHUB_TOKEN 等，用于 API 查询提升限流额度）
[ -f "$HOME/.deploy-env" ] && . "$HOME/.deploy-env"
# 服务专属配置（.env 受 rsync --exclude 保护，跨版本持久）
[ -f "$DIR/.env" ] && . "$DIR/.env"
export WEMONITOR_API_KEY="${WEMONITOR_API_KEY:-wemonitor-dev-key-change-me}"
# 9>&- 是必须的：常驻进程不能继承部署锁的 fd，否则锁永远不释放。
nohup node server.js > "$LOG" 2>&1 9>&- &
sleep 2
NEWPID=$(lsof -ti:$PORT 2>/dev/null)
if [ -n "$NEWPID" ]; then
  echo "[$(date)] started PID $NEWPID port $PORT"
  log_event "restart" "ok" "启动成功 PID $NEWPID :$PORT (v $VER)"
else
  echo "[$(date)] 启动失败，查看 $LOG"
  log_event "restart" "error" "启动失败 (v $VER)"
  tail -5 "$LOG"
fi
