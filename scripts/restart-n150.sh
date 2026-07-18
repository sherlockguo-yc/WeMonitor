#!/bin/bash
# WeMonitor 重启脚本（N150 生产环境，随 CI 产物一起分发）
PORT=18990
LOG=/tmp/wemonitor.log
DIR="$HOME/wemonitor"

# 杀旧进程
PID=$(lsof -ti:$PORT 2>/dev/null)
if [ -n "$PID" ]; then
  kill $PID 2>/dev/null
  sleep 1
  kill -9 $PID 2>/dev/null
  echo "[$(date)] stopped PID $PID"
fi

# 启动
cd "$DIR" || exit 1
export WEMONITOR_API_KEY="${WEMONITOR_API_KEY:-wemonitor-dev-key-change-me}"
nohup node server.js > "$LOG" 2>&1 &
sleep 2
NEWPID=$(lsof -ti:$PORT 2>/dev/null)
if [ -n "$NEWPID" ]; then
  echo "[$(date)] started PID $NEWPID port $PORT"
else
  echo "[$(date)] 启动失败，查看 $LOG"
  tail -5 "$LOG"
fi
