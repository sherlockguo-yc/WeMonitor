#!/bin/bash
# WeMonitor 自动更新脚本（N150 生产环境，由 cron 每分钟调用）
# 对齐 WeMusic 的更新模式：查 GitHub 最新 release → 比对版本 → 下载 → 部署
# 本脚本放在 ~/ 下，不在 ~/wemonitor/ 内，避免被 rsync --delete 清除
#
# 每个构建以 commit sha 作为唯一 release tag，下载地址按 sha 拼接，
# 因此不会命中 CDN 对 latest tag 的缓存（否则会滞后拿到上一版包）。

set -e

LOCK_FILE="/tmp/wemonitor-update.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  # 另一个实例正在运行，退出避免竞态
  exit 0
fi

REPO="sherlockguo-yc/WeMonitor"
DIR="$HOME/wemonitor"
LOG="/tmp/wemonitor-update.log"
EVENTS="$DIR/data/deploy-events.jsonl"
API="https://api.github.com/repos/$REPO/releases?per_page=1"

# 加载持久化凭据（.env 受 rsync --exclude 保护），GITHUB_TOKEN 用于将 API 额度从 60→5000/hr
[ -f "$DIR/.env" ] && . "$DIR/.env"

# 写入结构化部署事件
log_event() {
  local stage="$1" status="$2" message="$3"
  local ts=$(date +%s)
  mkdir -p "$DIR/data"
  echo "{\"stage\":\"$stage\",\"status\":\"$status\",\"message\":\"$message\",\"ts\":$ts}" >> "$EVENTS"
}

# 构建鉴权头（数组），token 为空时不传递 Authorization
AUTH_HDR=()
[ -n "${GITHUB_TOKEN:-}" ] && AUTH_HDR=(-H "Authorization: Bearer $GITHUB_TOKEN")

# ── 查询最新 release ──
# 使用 ETag 条件请求避免 API 限流：304 响应不消耗配额，仅 release 真正更新时才计费
ETAG_FILE="/tmp/wemonitor-etag"
API_BODY_FILE="/tmp/wemonitor-api-body"
API_HEADERS_FILE="/tmp/wemonitor-api-headers"

query_api() {
  local etag_val="$1"
  if [ -n "$etag_val" ]; then
    curl -sS --max-time 30 -o "$API_BODY_FILE" -w '%{http_code}' -D "$API_HEADERS_FILE" \
      -H "Cache-Control: no-cache" -H "If-None-Match: $etag_val" \
      "${AUTH_HDR[@]}" \
      --connect-timeout 10 "$API" 2>/dev/null
  else
    curl -sS --max-time 30 -o "$API_BODY_FILE" -w '%{http_code}' -D "$API_HEADERS_FILE" \
      -H "Cache-Control: no-cache" \
      "${AUTH_HDR[@]}" \
      --connect-timeout 10 "$API" 2>/dev/null
  fi
}

ETAG_VAL=""
[ -f "$ETAG_FILE" ] && ETAG_VAL=$(cat "$ETAG_FILE")
HTTP_CODE=$(query_api "$ETAG_VAL")

# 304 = 未修改，跳过（但仍记录检查事件，让用户看到 cron 在正常工作）
if [ "$HTTP_CODE" = "304" ]; then
  LOCAL_VER=$(cat "$DIR/.version" 2>/dev/null || echo "none")
  log_event "check" "ok" "已是最新版本 $LOCAL_VER"
  exit 0
fi

# 如果带 ETag 的请求失败（非 200 非 304），尝试不带 ETag 重试一次
if [ "$HTTP_CODE" != "200" ] && [ -n "$ETAG_VAL" ]; then
  rm -f "$ETAG_FILE"
  HTTP_CODE=$(query_api "")
fi

# 保存新 ETag（从响应头提取，保留完整值如 W/"xxx"）
grep -i '^etag:' "$API_HEADERS_FILE" 2>/dev/null | head -1 | sed 's/.*etag: //i' | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' > "$ETAG_FILE"

if [ "$HTTP_CODE" != "200" ]; then
  echo "[$(date)] API 返回非预期状态码 $HTTP_CODE" >> "$LOG"
  log_event "check" "error" "查询 release 失败 (HTTP $HTTP_CODE)"
  exit 0
fi

BODY=$(cat "$API_BODY_FILE")
REMOTE_VER=$(echo "$BODY" | grep -m1 '"body"' | sed -E 's/.*Auto build ([a-f0-9]+).*/\1/')

if [ -z "$REMOTE_VER" ] || [ "$REMOTE_VER" = "$BODY" ]; then
  echo "[$(date)] 查询 release 失败或无法解析版本" >> "$LOG"
  log_event "check" "error" "查询 release 失败"
  exit 0
fi

LOCAL_VER=$(cat "$DIR/.version" 2>/dev/null || echo "none")
if [ "$REMOTE_VER" = "$LOCAL_VER" ]; then
  log_event "check" "ok" "已是最新版本 $REMOTE_VER"
  exit 0  # 无更新
fi

echo "[$(date)] 发现新版本 $REMOTE_VER (当前: $LOCAL_VER)，开始部署" >> "$LOG"
log_event "download" "started" "发现新版本 $REMOTE_VER"

# 下载产物
# 优先按唯一 sha 拼接的地址（不命中缓存），镜像失败/404 时回退 latest tag。
# 优先 ghproxy.net 镜像，失败回退直连。
BASE="https://github.com/$REPO/releases/download"
MIRROR_BASE="https://ghproxy.net/$BASE"
TMP="/tmp/wemonitor-latest.tar.gz"
DOWNLOAD_OK=0

for SLUG in "$REMOTE_VER" "latest"; do
  URL="$BASE/$SLUG/wemonitor.tar.gz"
  MIRROR_URL="$MIRROR_BASE/$SLUG/wemonitor.tar.gz"

  # 先试镜像（5 次）
  for i in 1 2 3 4 5; do
    if curl -sSL --max-time 60 --connect-timeout 15 -o "$TMP" "$MIRROR_URL" 2>/dev/null && file "$TMP" | grep -q "gzip"; then
      DOWNLOAD_OK=1; break 2
    fi
    sleep 3
  done

  # 镜像失败则直连（8 次）
  for i in 1 2 3 4 5 6 7 8; do
    if curl -sSL --max-time 60 --connect-timeout 20 -o "$TMP" "$URL" 2>/dev/null && file "$TMP" | grep -q "gzip"; then
      DOWNLOAD_OK=1; break 2
    fi
    sleep 3
  done
done

if [ "$DOWNLOAD_OK" -ne 1 ]; then
  echo "[$(date)] 下载失败（镜像+直连均重试后失败）" >> "$LOG"
  log_event "download" "error" "下载失败"
  rm -f "$TMP"
  exit 0
fi

log_event "download" "ok" "下载完成 $REMOTE_VER"

# 解压到临时目录
STAGE="/tmp/wemonitor-stage"
rm -rf "$STAGE" && mkdir -p "$STAGE"
if ! tar -xzf "$TMP" -C "$STAGE"; then
  echo "[$(date)] 解压失败" >> "$LOG"
  log_event "deploy" "error" "解压失败"
  rm -f "$TMP"; exit 0
fi

# 校验：解压出的 .version 应与远端一致
STAGE_VER=$(cat "$STAGE/.version" 2>/dev/null)
if [ "$STAGE_VER" != "$REMOTE_VER" ]; then
  echo "[$(date)] 版本校验失败: 包内=$STAGE_VER 期望=$REMOTE_VER" >> "$LOG"
  log_event "deploy" "error" "版本校验失败"
  rm -rf "$STAGE" "$TMP"; exit 0
fi

# 同步到运行目录（--delete 清理旧文件，但保护 data/ 和 .env）
log_event "deploy" "started" "开始同步文件 $REMOTE_VER"
mkdir -p "$DIR"
rsync -a --delete --exclude 'data' --exclude '.env' "$STAGE/" "$DIR/"
rm -rf "$STAGE" "$TMP"
log_event "deploy" "ok" "文件同步完成 $REMOTE_VER"

# 重启
# 关键：200>&- 关闭更新锁 fd，避免 node 进程继承后长期持有锁，
# 导致后续所有 cron 更新在 flock 检查处静默退出、永远拉不到新版本。
bash "$DIR/restart.sh" 200>&- >> "$LOG" 2>&1
echo "[$(date)] 部署完成 → $REMOTE_VER" >> "$LOG"

# flock 在脚本退出时自动释放
