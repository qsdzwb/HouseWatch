require('dotenv').config();
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { healthCheck } = require('./db/pool');

const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 请求日志
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (config.logLevel === 'debug' || duration > 1000) {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// 路由
app.use('/api/projects', require('./routes/projects'));
app.use('/api/buildings', require('./routes/buildings'));
app.use('/api/houses', require('./routes/houses'));
app.use('/api/changes', require('./routes/changes'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/crawl', require('./routes/crawl'));

// 健康检查
app.get('/api/health', async (req, res) => {
  const dbOk = await healthCheck();
  res.json({
    status: 'ok',
    database: dbOk ? 'connected' : 'disconnected',
    mode: config.crawl.mode,
    uptime: process.uptime(),
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: '接口不存在' });
});

// 错误处理
app.use((err, req, res, _next) => {
  console.error('未捕获错误:', err);
  res.status(500).json({ success: false, message: '服务器内部错误' });
});

// 启动
app.listen(config.server.port, () => {
  console.log(`\n🏠 北京住建委网签数据服务已启动`);
  console.log(`   端口: ${config.server.port}`);
  console.log(`   模式: ${config.crawl.mode}`);
  console.log(`   接口: http://localhost:${config.server.port}/api/health\n`);
});

module.exports = app;
