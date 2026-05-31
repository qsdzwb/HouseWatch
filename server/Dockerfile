# 北京住建委网签数据 API 服务（含 Chromium，支持爬虫）
FROM node:22-alpine

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
# Chromium 路径由 browser.js 自动检测，也可通过环境变量覆盖
ENV CRAWL_CHROME_PATH=/usr/bin/chromium-browser
ENV CRAWL_MODE=production

# 安装 Chromium + 中文字体（网页渲染需要）
RUN apk add --no-cache \
    chromium \
    chromium-driver \
    font-noto-cjk \
    ttf-liberation \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    wget \
    && rm -rf /var/cache/apk/*

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# 先复制 package.json，利用 Docker 缓存层
COPY package.json package-lock.json ./

# 安装 npm 依赖（PUPPETEER_SKIP_DOWNLOAD 已设为环境变量）
RUN npm ci --omit=dev && npm cache clean --force

# 复制源码
COPY src/ ./src/
COPY scripts/ ./scripts/

# 创建数据目录并设置权限
RUN mkdir -p /app/data /app/logs && \
    chown -R nodejs:nodejs /app

USER nodejs

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "src/index.js"]
