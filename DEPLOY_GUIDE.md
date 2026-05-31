# 北京住建委网签数据 — 后端 Docker 部署指南

## 一、CVM 环境准备（只需 Docker）

```bash
# CVM 上安装 Docker（OpenCloudOS 9 / RHEL 9）
dnf install -y docker
systemctl enable docker --now
docker --version
```

---

## 二、本地构建镜像并上传

### Mac 上执行：

```bash
cd /Users/zwb/WorkBuddy/2026-05-24-19-21-57/server

# 1. 构建镜像（跳过 Puppeteer Chromium，只打包 API 服务）
docker build -t bj-realestate-api:latest .

# 2. 导出镜像为 tar 文件
docker save bj-realestate-api:latest | gzip > /tmp/bj-api-image.tar.gz

# 3. 上传到 CVM（替换 your_cvm_ip）
scp /tmp/bj-api-image.tar.gz root@your_cvm_ip:/tmp/
```

> 如果你 Mac 没装 Docker，也可以在 CVM 上直接构建（步骤见下方方案 B）

---

## 三、CVM 上启动服务

```bash
# SSH 登录 CVM 后执行：

# 1. 导入镜像
docker load < /tmp/bj-api-image.tar.gz

# 2. 创建部署目录
mkdir -p /opt/bj-server
cd /opt/bj-server

# 3. 复制 docker-compose.yml 到 CVM
# （如果你 Mac 有 scp，本地执行：）
# scp server/docker-compose.yml root@your_cvm_ip:/opt/bj-server/
# 
# 或者在 CVM 上创建 docker-compose.yml（内容见下方）

# 4. 把本地数据库文件复制到 CVM
# scp server/data/bj_realestate.db root@your_cvm_ip:/opt/bj-server/data/

# 5. 启动容器
docker run -d \
  --name bj-realestate-api \
  --restart unless-stopped \
  -p 3000:3000 \
  -v /opt/bj-server/data:/app/data \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e DB_TYPE=sqlite \
  -e DB_SQLITE_PATH=/app/data/bj_realestate.db \
  -e LOG_LEVEL=info \
  -e CRAWL_MODE=production \
  bj-realestate-api:latest

# 6. 验证
curl http://localhost:3000/api/health
```

---

## 方案 B：CVM 上直接构建（无 Mac Docker）

如果 Mac 没装 Docker，可以把源码上传到 CVM，在 CVM 上构建：

```bash
# Mac 上打包源码
cd /Users/zwb/WorkBuddy/2026-05-24-19-21-57
COPYFILE_DISABLE=1 tar -czf /tmp/bj-server-src.tar.gz \
  server/Dockerfile \
  server/.dockerignore \
  server/docker-compose.yml \
  server/package.json \
  server/package-lock.json \
  server/src \
  server/data
scp /tmp/bj-server-src.tar.gz root@your_cvm_ip:/tmp/

# CVM 上
mkdir -p /opt/bj-server && cd /opt/bj-server
tar -xzf /tmp/bj-server-src.tar.gz --strip-components=1
docker build -t bj-realestate-api:latest .
docker run -d --name bj-realestate-api --restart unless-stopped \
  -p 3000:3000 -v /opt/bj-server/data:/app/data \
  -e NODE_ENV=production -e PORT=3000 -e DB_TYPE=sqlite \
  -e DB_SQLITE_PATH=/app/data/bj_realestate.db \
  -e LOG_LEVEL=info -e CRAWL_MODE=production \
  bj-realestate-api:latest
```

---

## 四、开放端口

腾讯云 CVM 控制台 → 安全组 → 添加入站规则：
- 协议：TCP
- 端口：3000
- 来源：0.0.0.0/0

```bash
# OpenCloudOS 防火墙（如果开了 firewalld）
firewall-cmd --add-port=3000/tcp --permanent
firewall-cmd --reload
```

---

## 五、常用 Docker 命令

| 命令 | 说明 |
|------|------|
| `docker ps` | 查看运行中的容器 |
| `docker logs bj-realestate-api -f` | 实时日志 |
| `docker logs bj-realestate-api --tail 50` | 最近50行日志 |
| `docker restart bj-realestate-api` | 重启服务 |
| `docker stop bj-realestate-api` | 停止服务 |
| `docker start bj-realestate-api` | 启动已停止的服务 |
| `docker exec -it bj-realestate-api sh` | 进入容器内部 |
| `docker rm -f bj-realestate-api` | 强制删除容器 |

---

## 六、更新服务

```bash
# 重新构建并部署
cd /opt/bj-server
docker build -t bj-realestate-api:latest .
docker stop bj-realestate-api && docker rm bj-realestate-api
docker run -d --name bj-realestate-api --restart unless-stopped \
  -p 3000:3000 -v /opt/bj-server/data:/app/data \
  -e NODE_ENV=production -e PORT=3000 -e DB_TYPE=sqlite \
  -e DB_SQLITE_PATH=/app/data/bj_realestate.db \
  -e LOG_LEVEL=info -e CRAWL_MODE=production \
  bj-realestate-api:latest
```

---

## 七、小程序 API 地址

修改 `miniprogram/utils/api.js`：

```javascript
// 替换为 CVM 公网 IP
const BASE = 'http://your_cvm_ip:3000/api';
```

> ⚠️ 开发阶段：微信开发者工具 → 详情 → 本地设置 → 勾选「不校验合法域名」

---

## 八、一次性全量初始化 — 爬取北京住建委全部楼盘列表

> 此步骤只需执行一次，将 ~9000 个楼盘的基本信息导入数据库，使关注页下拉列表能展示所有楼盘。

### 8.1 Mac 上：爬取楼盘列表（需要 Chrome 浏览器）

```bash
cd /Users/zwb/WorkBuddy/2026-05-24-19-21-57

# 先探索模式 — 看页面结构是否正确
node crawler/crawl_project_list.js --explore

# 查看探索结果
cat crawler/output/page_analysis.json | python3 -m json.tool | head -50

# 确认结构正确后，全量爬取（约 30-120 分钟，取决于网速）
node crawler/crawl_project_list.js

# 查看结果
cat crawler/output/project_list.json | python3 -m json.tool | head -30
wc -l crawler/output/project_list.json
```

### 8.2 上传 JSON 到 CVM 并导入数据库

```bash
# 1. 上传 project_list.json 到 CVM
scp crawler/output/project_list.json root@118.25.138.63:/tmp/

# 2. 更新 CVM 上的后端代码（projects.js 带批量导入端点）
cd server
COPYFILE_DISABLE=1 tar -czf /tmp/bj-server-src.tar.gz \
  Dockerfile .dockerignore docker-compose.yml \
  package.json package-lock.json src scripts
scp /tmp/bj-server-src.tar.gz root@118.25.138.63:/tmp/

# 3. SSH 登录 CVM
ssh root@118.25.138.63

# 4. 导库（通过 API 或直接脚本）
# 方式 A：通过 API（服务必须运行中）
curl -X POST http://localhost:3000/api/projects/batch \
  -H "Content-Type: application/json" \
  -d @/tmp/project_list.json

# 方式 B：直接运行导入脚本
cd /opt/bj-server
tar -xzf /tmp/bj-server-src.tar.gz --strip-components=1
node scripts/import_projects.js /tmp/project_list.json

# 5. 验证
curl "http://localhost:3000/api/projects?limit=5" | python3 -m json.tool
```

### 8.3 更新小程序代码

```bash
# watchlist 页面已改为搜索模式
# 把修改后的文件复制到微信开发者工具项目目录即可
# miniprogram/pages/watchlist/watchlist.js
# miniprogram/pages/watchlist/watchlist.wxml
# server/src/routes/projects.js (已含 POST /batch 端点)
```

### 8.4 初始化后的效果

- `关注管理页` → 点击「+ 添加」→ 输入楼盘名搜索 → 选中添加
- `项目列表页` → 展示全部楼盘（含房源自统计）
- 只有**被关注的项目**才会触发详细数据爬取（楼栋/房屋）

---

## 九、CVM 爬虫环境（让 CVM 能直接爬数据）

## 九、爬虫命令接口（统一 API）

所有爬取任务通过 HTTP API 触发，无需登录服务器执行命令。

### 9.1 触发爬取

```bash
# 全量爬取楼盘列表（约 600 页, 9000+ 楼盘, ~5 分钟）
curl -X POST http://118.25.138.63:3000/api/crawl/trigger \
  -H 'Content-Type: application/json' \
  -d '{"command":"list","force":true}'

# 增量更新列表（只爬新楼盘，~10 秒）
curl -X POST http://118.25.138.63:3000/api/crawl/trigger \
  -H 'Content-Type: application/json' \
  -d '{"command":"list"}'

# 爬取关注项目详情（楼栋/房屋/网签）
curl -X POST http://118.25.138.63:3000/api/crawl/trigger \
  -H 'Content-Type: application/json' \
  -d '{"command":"detail"}'

# 全部：列表 + 关注项目详情
curl -X POST http://118.25.138.63:3000/api/crawl/trigger \
  -H 'Content-Type: application/json' \
  -d '{"command":"all","force":true}'
```

### 9.2 查询任务状态

```bash
# 替换 <taskId> 为触发返回的 taskId
curl http://118.25.138.63:3000/api/crawl/status/<taskId>

# 查看运行中的任务
curl http://118.25.138.63:3000/api/crawl/running

# 查看历史记录
curl http://118.25.138.63:3000/api/crawl/history?limit=20
```

### 9.3 返回示例

**触发响应：**
```json
{
  "success": true,
  "data": {
    "taskId": "crawl_1717080000000_1",
    "command": "list",
    "status": "running",
    "message": "任务已启动，通过 GET /api/crawl/status/crawl_1717080000000_1 查询进度"
  }
}
```

**状态响应：**
```json
{
  "success": true,
  "data": {
    "command": "list",
    "status": "done",
    "startTime": "2026-05-31T04:00:00.000Z",
    "duration": 287000,
    "result": { "inserted": 150, "updated": 8874, "failed": 0 }
  }
}
```

### 9.4 API 命令说明

| command | 说明 | 参数 | 耗时 |
|---------|------|------|------|
| `list` | 爬取楼盘列表（全量/增量） | `force:true` 强制全量 | 10s~5min |
| `detail` | 爬取关注项目的楼栋/房屋详情 | `test:true` 测试模式 | 视关注数量 |
| `all` | 列表 + 详情 | `force`, `test` | 视规模 |

> **增量逻辑**：`list` 命令默认增量模式（检测最新发证日期，只爬新数据）。传 `force:true` 强制全量。
> **详情爬虫**：仍需要 Chrome。如果 CVM 未装 Chrome，`detail` 命令会失败。建议列表用 CVM，详情用 Mac 或后续补充 Chrome。

### 9.5 定时任务（推荐）

```bash
# 每天凌晨 2 点：增量更新楼盘列表
echo '0 2 * * * curl -X POST http://localhost:3000/api/crawl/trigger -H "Content-Type: application/json" -d "{\"command\":\"list\"}"' > /etc/cron.d/bj-crawler

# 每周日凌晨 3 点：全量列表刷新
echo '0 3 * * 0 curl -X POST http://localhost:3000/api/crawl/trigger -H "Content-Type: application/json" -d "{\"command\":\"list\",\"force\":true}"' >> /etc/cron.d/bj-crawler
```

### 9.6 缓存状态检查

```bash
curl http://localhost:3000/api/projects/cache-status
```

返回示例：
```json
{
  "data": {
    "data_ready": true,
    "project_count": 9024,
    "last_import": "2026-05-26T00:10:00.000Z",
    "is_fresh": true,
    "needs_refresh": false,
    "needs_init": false
  }
}
```

