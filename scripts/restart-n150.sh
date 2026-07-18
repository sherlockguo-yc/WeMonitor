#!/bin/bash
# WeMonitor 重启脚本（N150 生产环境，随 CI 产物一起分发）
PORT=18990
LOG=/tmp/wemonitor.log
DIR="$HOME/wemonitor"
EVENTS="$DIR/data/deploy-events.jsonl"

log_event() {
  local stage="$1" status="$2" message="$3"
  local ts=$(date +%s)
  mkdir -p "$DIR/data"
  echo "{\"stage\":\"$stage\",\"status\":\"$status\",\"message\":\"$message\",\"ts\":$ts}" >> "$EVENTS"
}

# 读取当前部署版本
VER=$(cat "$DIR/.version" 2>/dev/null || echo "unknown")

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
nohup node server.js > "$LOG" 2>&1 &
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
