#!/bin/bash
# 一键同步代码到 CVM 并重启服务
# 用法: bash scripts/deploy.sh

set -e

CVM_HOST="${CVM_HOST:-118.25.138.63}"
CVM_PATH="${CVM_PATH:-/opt/bj-server}"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== 同步代码到 CVM ==="
echo "本地: $LOCAL_DIR/server"
echo "远端: root@${CVM_HOST}:${CVM_PATH}"
echo ""

# 同步 server 目录
rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='*.db' \
  --exclude='browsers/' \
  --exclude='.cache/' \
  "$LOCAL_DIR/server/" \
  "root@${CVM_HOST}:${CVM_PATH}/"

echo ""
echo "=== 安装依赖 + 重启服务 ==="
ssh "root@${CVM_HOST}" "cd ${CVM_PATH} && npm install --omit=dev && pm2 restart bj-realestate --update-env"

echo ""
echo "=== 验证 ==="
sleep 2
ssh "root@${CVM_HOST}" "curl -s http://localhost:3000/api/health"

echo ""
echo ""
echo "✅ 部署完成"
