#!/bin/bash
# crawl_v7_wrapper.sh — 关注楼盘爬虫包装脚本（重试版）
# 功能：运行 crawlWatchlist.py，失败时每 30 分钟重试，最多重试 4 次（共 2 小时）

LOCK_FILE="/tmp/crawl_watchlist.lock"
LOG_DIR="/user/local/service/house/logs"
LOG_FILE="$LOG_DIR/crawl_watchlist_$(date +%Y%m%d).log"
SCRIPT_PATH="/user/local/service/house/src/crawler/crawlWatchlist.py"
MAX_RETRIES=4
RETRY_DELAY=1800  # 30 分钟 = 1800 秒

# 防止并发
exec 200>"$LOCK_FILE"
flock -n 200 || {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️ 已有实例运行中，跳过" >> "$LOG_FILE"
    exit 0
}

mkdir -p "$LOG_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "🚀 开始运行 crawlWatchlist (最多重试 $MAX_RETRIES 次，间隔 30 分钟)"

for i in $(seq 0 $MAX_RETRIES); do
    if [ $i -gt 0 ]; then
        log "🔄 第 $i 次重试（等待 30 分钟）..."
        sleep $RETRY_DELAY
    fi

    log "▶️  第 $((i+1)) 次尝试运行 crawlWatchlist..."

    /usr/bin/python3 -u "$SCRIPT_PATH" >> "$LOG_FILE" 2>&1
    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 0 ]; then
        log "✅ crawlWatchlist 运行成功（尝试 $((i+1)) 次）"
        exit 0
    else
        log "❌ crawlWatchlist 运行失败（退出码 $EXIT_CODE，尝试 $((i+1))/$((MAX_RETRIES+1))）"
    fi
done

log "💀 已达最大重试次数 ($MAX_RETRIES)，放弃本次运行"
exit 1
