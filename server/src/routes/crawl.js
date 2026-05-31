/**
 * 统一爬虫命令接口
 *
 * POST /api/crawl/trigger
 *   接收 { command: "list" | "detail" | "all", force?: boolean }
 *   返回 { success: true, data: { taskId, command, status } }
 *
 * GET /api/crawl/status/:taskId
 *   查询任务执行状态
 *
 * GET /api/crawl/history
 *   查询历史执行记录
 */

const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('../db/pool');

// 任务状态存储（内存中，服务重启会丢失历史，持久化依赖 crawl_logs 表）
const tasks = {};

// 序列号
var taskSeq = 0;

/**
 * 生成任务ID
 */
function genTaskId() {
  taskSeq++;
  return 'crawl_' + Date.now() + '_' + taskSeq;
}

/**
 * 执行列表爬虫（同步等待完成，直接写 DB）
 */
function runListCrawl(taskId, incremental) {
  return new Promise(function(resolve) {
    var startTime = Date.now();
    var scriptPath = path.resolve(__dirname, '../crawler/crawlProjectList.js');
    var args = [scriptPath];
    if (incremental) args.push('--incremental');

    var child = spawn(process.execPath, args, {
      cwd: path.resolve(__dirname, '../..'),
      env: Object.assign({}, process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    var stdout = '';
    var stderr = '';

    child.stdout.on('data', function(d) { stdout += d.toString(); });
    child.stderr.on('data', function(d) { stderr += d.toString(); });

    child.on('close', function(code) {
      var duration = Date.now() - startTime;

      // 从输出中解析统计
      var inserted = 0, updated = 0, failed = 0;
      var m = stdout.match(/新增:\s*(\d+)\s*更新:\s*(\d+)\s*失败:\s*(\d+)/);
      if (m) { inserted = parseInt(m[1]); updated = parseInt(m[2]); failed = parseInt(m[3]); }

      tasks[taskId] = {
        command: incremental ? 'list-incremental' : 'list',
        status: code === 0 ? 'done' : 'failed',
        startTime: new Date(startTime).toISOString(),
        duration: duration,
        result: { inserted: inserted, updated: updated, failed: failed },
        exitCode: code,
        output: stdout.slice(-2000),
      };

      // 写入 crawl_logs
      db.insert(
        "INSERT INTO crawl_logs (crawl_date, phase, project_id, status, message) VALUES (?,?,?,?,?)",
        [new Date().toISOString().split('T')[0], 'list', '', code === 0 ? 'success' : 'fail',
         '列表爬虫: 新增' + inserted + ' 更新' + updated]
      ).catch(function(){});

      resolve();
    });
  });
}

/**
 * 执行详情爬虫（dailyJob.js，关注项目）
 */
function runDetailCrawl(taskId, testMode) {
  return new Promise(function(resolve) {
    var startTime = Date.now();
    var scriptPath = path.resolve(__dirname, '../scheduler/dailyJob.js');
    var args = [scriptPath];
    if (testMode) args.push('--test');

    var child = spawn(process.execPath, args, {
      cwd: path.resolve(__dirname, '../..'),
      env: Object.assign({}, process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    var stdout = '';
    var stderr = '';

    child.stdout.on('data', function(d) { stdout += d.toString(); });
    child.stderr.on('data', function(d) { stderr += d.toString(); });

    child.on('close', function(code) {
      var duration = Date.now() - startTime;

      // 解析汇总
      var snapshots = 0, changes = 0;
      var m1 = stdout.match(/快照数:\s*(\d+)/);
      var m2 = stdout.match(/变化数:\s*(\d+)/);
      if (m1) snapshots = parseInt(m1[1]);
      if (m2) changes = parseInt(m2[1]);

      tasks[taskId] = {
        command: testMode ? 'detail-test' : 'detail',
        status: code === 0 ? 'done' : 'failed',
        startTime: new Date(startTime).toISOString(),
        duration: duration,
        result: { snapshots: snapshots, changes: changes },
        exitCode: code,
        output: stdout.slice(-2000),
      };

      resolve();
    });
  });
}

// ============================================
// POST /api/crawl/trigger — 触发爬取任务
// ============================================
router.post('/trigger', async function(req, res) {
  var { command, force, test } = req.body || {};

  if (!command || !['list', 'detail', 'all'].includes(command)) {
    return res.status(400).json({
      success: false,
      message: '请提供有效的 command 参数: list | detail | all',
      example: { command: 'list', force: false, test: false },
    });
  }

  var taskId = genTaskId();
  tasks[taskId] = { command: command, status: 'running', startTime: new Date().toISOString() };

  // 异步执行，不阻塞响应
  setImmediate(async function() {
    try {
      if (command === 'list' || command === 'all') {
        var isIncremental = !force;
        // 检查是否有数据
        var count = await db.queryOne('SELECT COUNT(*) as cnt FROM projects');
        if (count && count.cnt > 0 && force) {
          console.log('[crawl] 强制全量模式');
          isIncremental = false;
        }
        await runListCrawl(taskId + '_list', isIncremental);
      }

      if (command === 'detail' || command === 'all') {
        await runDetailCrawl(taskId + '_detail', test || false);
      }

      // 合并结果
      var listResult = tasks[taskId + '_list'];
      var detailResult = tasks[taskId + '_detail'];

      tasks[taskId] = {
        command: command,
        status: 'done',
        startTime: tasks[taskId].startTime,
        duration: Date.now() - new Date(tasks[taskId].startTime).getTime(),
        list: listResult ? listResult.result : null,
        detail: detailResult ? detailResult.result : null,
      };
    } catch (e) {
      tasks[taskId] = { command: command, status: 'failed', error: e.message };
    }
  });

  res.json({
    success: true,
    data: {
      taskId: taskId,
      command: command,
      status: 'running',
      message: '任务已启动，通过 GET /api/crawl/status/' + taskId + ' 查询进度',
    },
  });
});

// ============================================
// GET /api/crawl/status/:taskId — 查询任务状态
// ============================================
router.get('/status/:taskId', function(req, res) {
  var task = tasks[req.params.taskId];
  if (!task) {
    return res.status(404).json({ success: false, message: '任务不存在或已过期' });
  }
  res.json({ success: true, data: task });
});

// ============================================
// GET /api/crawl/history — 历史爬取记录
// ============================================
router.get('/history', async function(req, res) {
  try {
    var limit = parseInt(req.query.limit, 10) || 20;
    var logs = await db.query(
      "SELECT * FROM crawl_logs ORDER BY id DESC LIMIT ?",
      [limit]
    );
    res.json({ success: true, data: { logs: logs, total: logs.length } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ============================================
// GET /api/crawl/running — 当前运行中的任务
// ============================================
router.get('/running', function(req, res) {
  var running = [];
  for (var id in tasks) {
    var t = tasks[id];
    if (t.status === 'running' && !id.endsWith('_list') && !id.endsWith('_detail')) {
      running.push({ taskId: id, command: t.command, startTime: t.startTime });
    }
  }
  res.json({ success: true, data: { running: running, count: running.length } });
});

module.exports = router;
