#!/bin/bash
# 全量活跃楼盘数据更新 v1 - wrapper
# 用法: bash /path/to/crawl_all_active_wrapper.sh

set -e
export PYTHONUNBUFFERED=1
LOG_DIR="/user/local/service/house/logs"
mkdir -p "$LOG_DIR"
TS=$(date +%Y%m%d_%H%M%S)
LOG="$LOG_DIR/crawl_all_active_v1_$TS.log"
WRAPPER_LOG="$LOG_DIR/crawl_all_active_v1_wrapper.log"

echo "===== 开始 $(date '+%Y-%m-%d %H:%M:%S') =====" >> "$WRAPPER_LOG"
echo "日志: $LOG" >> "$WRAPPER_LOG"

cd /user/local/service/house/server/src/crawler
/usr/bin/python3 crawlAllActive_v1.py 2>&1 | tee "$LOG"
EXIT_CODE=${PIPESTATUS[0]}

echo "===== 结束 $(date '+%Y-%m-%d %H:%M:%S') 退出码:$EXIT_CODE =====" >> "$WRAPPER_LOG"
exit $EXIT_CODE
