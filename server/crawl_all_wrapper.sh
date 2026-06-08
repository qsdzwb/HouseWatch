#!/bin/bash
# 爬虫总调度 wrapper — 按顺序执行所有爬取任务，天然不冲突
# 用法: bash /path/to/crawl_all_wrapper.sh

set -e
export PYTHONUNBUFFERED=1

LOG_DIR="/user/local/service/house/logs"
mkdir -p "$LOG_DIR"
TS=$(date +%Y%m%d_%H%M%S)
LOG="$LOG_DIR/crawl_all_$TS.log"
LOCK_FILE="/tmp/house_crawler.lock"

echo "===== 开始 $(date '+%Y-%m-%d %H:%M:%S') =====" | tee -a "$LOG"
echo "日志: $LOG" | tee -a "$LOG_DIR/crawl_all_latest.log"

# 文件锁：防止多个实例同时运行
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "另一个爬虫实例正在运行（锁文件: $LOCK_FILE），退出。" | tee -a "$LOG"
    exit 1
fi
echo "获取文件锁成功" | tee -a "$LOG"

SCRIPT_DIR="/user/local/service/house/server/src/crawler"

# ── Step 1: 关注楼盘更新 ──
echo "" | tee -a "$LOG"
echo "===== [Step 1/2] 关注楼盘更新 $(date '+%H:%M:%S') =====" | tee -a "$LOG"
cd "$SCRIPT_DIR"
/usr/bin/python3 crawlWatchlist_v8.py 2>&1 | tee -a "$LOG"
EXIT1=${PIPESTATUS[0]}
echo "[Step 1] 退出码: $EXIT1" | tee -a "$LOG"

# ── Step 2: 全量活跃楼盘更新 ──
echo "" | tee -a "$LOG"
echo "===== [Step 2/2] 全量活跃楼盘更新 $(date '+%H:%M:%S') =====" | tee -a "$LOG"
/usr/bin/python3 crawlAllActive_v2.py 2>&1 | tee -a "$LOG"
EXIT2=${PIPESTATUS[0]}
echo "[Step 2] 退出码: $EXIT2" | tee -a "$LOG"

# ── 汇总 ──
echo "" | tee -a "$LOG"
echo "===== 完成 $(date '+%Y-%m-%d %H:%M:%S') =====" | tee -a "$LOG"
echo "Step1 退出码: $EXIT1 | Step2 退出码: $EXIT2" | tee -a "$LOG"

# 释放锁（自动，脚本退出时 exec 9 关闭）
exit $((EXIT1 > EXIT2 ? EXIT1 : EXIT2))
