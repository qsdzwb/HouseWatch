#!/bin/bash
# ============================================
# CVM 爬虫环境一键安装
# 适用: OpenCloudOS 9.4 / RHEL 9 / CentOS 9
# ============================================
set -e

echo "=== 北京住建委爬虫 — CVM 环境安装 ==="
echo ""

# 1. 安装 Chromium
echo "[1/4] 安装 Chromium 浏览器..."
if command -v chromium-browser &>/dev/null || command -v chromium &>/dev/null; then
  echo "  ✅ Chromium 已安装"
else
  # OpenCloudOS 9 使用 dnf
  if command -v dnf &>/dev/null; then
    # EPEL 源提供 chromium
    dnf install -y epel-release 2>/dev/null || true
    dnf install -y chromium-headless 2>/dev/null || dnf install -y chromium 2>/dev/null || {
      echo "  ⚠️  dnf 安装失败，尝试从腾讯云镜像下载..."
      # 备用方案：下载静态 Chromium
      CHROME_URL="https://mirrors.tencent.com/chromium-browser-snapshots/Linux_x64/1095492/chrome-linux.zip"
      curl -L -o /tmp/chrome-linux.zip "$CHROME_URL" 2>/dev/null || {
        echo "  ❌ 无法安装 Chromium，请手动安装"
        exit 1
      }
      mkdir -p /opt/chromium
      unzip -o /tmp/chrome-linux.zip -d /opt/chromium/
      ln -sf /opt/chromium/chrome-linux/chrome /usr/bin/chromium-browser
      rm -f /tmp/chrome-linux.zip
    }
  fi
fi

# 确定 Chromium 路径
if [ -f "/usr/bin/chromium-browser" ]; then
  CHROME_PATH="/usr/bin/chromium-browser"
elif [ -f "/usr/bin/chromium" ]; then
  CHROME_PATH="/usr/bin/chromium"
elif [ -f "/opt/chromium/chrome-linux/chrome" ]; then
  CHROME_PATH="/opt/chromium/chrome-linux/chrome"
else
  echo "  ❌ 找不到 Chromium 可执行文件"
  exit 1
fi
echo "  Chrome 路径: $CHROME_PATH"

# 2. 安装依赖库
echo ""
echo "[2/4] 安装 Chromium 依赖..."
if command -v dnf &>/dev/null; then
  dnf install -y \
    atk at-spi2-atk cups-libs libdrm libXcomposite libXdamage \
    libXrandr mesa-libgbm pango alsa-lib 2>/dev/null || true
fi
echo "  ✅ 依赖安装完成"

# 3. 配置环境变量
echo ""
echo "[3/4] 配置环境变量..."
ENV_FILE="/opt/bj-server/.env"

# 创建或更新 .env
if [ ! -f "$ENV_FILE" ]; then
  touch "$ENV_FILE"
fi

# 更新 Chrome 路径
if grep -q "CRAWL_CHROME_PATH" "$ENV_FILE"; then
  sed -i "s|CRAWL_CHROME_PATH=.*|CRAWL_CHROME_PATH=$CHROME_PATH|" "$ENV_FILE"
else
  echo "" >> "$ENV_FILE"
  echo "# Chromium 浏览器路径" >> "$ENV_FILE"
  echo "CRAWL_CHROME_PATH=$CHROME_PATH" >> "$ENV_FILE"
fi

# 更新爬取模式为生产
if grep -q "CRAWL_MODE" "$ENV_FILE"; then
  sed -i "s|CRAWL_MODE=.*|CRAWL_MODE=production|" "$ENV_FILE"
else
  echo "CRAWL_MODE=production" >> "$ENV_FILE"
fi

echo "  ✅ .env 已更新"

# 4. 验证
echo ""
echo "[4/4] 验证 Chromium..."
if $CHROME_PATH --version 2>/dev/null || $CHROME_PATH --no-sandbox --version 2>/dev/null; then
  echo "  ✅ Chromium 运行正常"
else
  echo "  ⚠️  Chromium 版本检测失败（可能不影响使用）"
fi

echo ""
echo "============================================"
echo " 安装完成！"
echo ""
echo " Chromium: $CHROME_PATH"
echo " 配置: CRAWL_CHROME_PATH=$CHROME_PATH"
echo "      CRAWL_MODE=production"
echo ""
echo " 测试爬虫:"
echo "   cd /opt/bj-server"
echo "   npm run crawl:test"
echo "============================================"
