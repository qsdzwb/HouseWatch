#!/usr/bin/env node

/**
 * 每日定时爬取任务（容错增强版）
 *
 * 用法:
 *   node src/scheduler/dailyJob.js              # 正常模式
 *   node src/scheduler/dailyJob.js --test       # 测试模式（仅爬样本项目）
 *
 * 容错特性:
 *   - 单项目失败不中断整体任务，继续下一个
 *   - 所有失败项目持久化到 failed_projects.json，可重试
 *   - 任务超时检测（默认 2 小时），防止僵尸进程
 *   - 最终汇总成功/失败/跳过数量
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const config = require('../config');
const db = require('../db/pool');
const { crawlProjects } = require('../services/crawlService');
const snapshotService = require('../services/snapshotService');
const fs = require('fs');
const path = require('path');

// 任务级超时（2 小时）
const JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000;

// 失败记录文件
const FAILED_FILE = path.resolve(__dirname, '../../data/failed_projects.json');

/**
 * 加载历史失败记录（用于重试）
 */
function loadFailedProjects() {
  try {
    if (fs.existsSync(FAILED_FILE)) {
      return JSON.parse(fs.readFileSync(FAILED_FILE, 'utf8'));
    }
  } catch (e) {}
  return { projects: [], lastCleanup: '' };
}

/**
 * 保存失败记录
 */
function saveFailedProjects(data) {
  var dir = path.dirname(FAILED_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FAILED_FILE, JSON.stringify(data, null, 2));
}

/**
 * 从失败列表中移除（重试成功时调用）
 */
function removeFromFailed(projectId) {
  var data = loadFailedProjects();
  var before = data.projects.length;
  data.projects = data.projects.filter(function(p) { return p.project_id !== projectId; });
  if (data.projects.length !== before) {
    saveFailedProjects(data);
    console.log('  ✅ 从失败列表移除 projectID=' + projectId);
  }
}

async function main() {
  const startTime = Date.now();
  const today = new Date().toISOString().split('T')[0];
  const isTest = process.argv.includes('--test');
  var jobTimedOut = false;

  // 任务超时检测器
  var timeoutHandle = setTimeout(function() {
    jobTimedOut = true;
    console.error('\n⏰ 任务超时（' + (JOB_TIMEOUT_MS / 60000) + '分钟），强制终止');
    process.exit(1);
  }, JOB_TIMEOUT_MS);

  console.log(`\n🕐 定时爬取任务启动 — ${new Date().toLocaleString('zh-CN')}`);
  console.log(`   模式: ${isTest ? '测试' : config.crawl.mode}`);
  console.log(`   日期: ${today}`);
  console.log(`   超时: ${JOB_TIMEOUT_MS / 60000} 分钟`);

  // 1. 数据库连接检查（带重试）
  var dbHealthy = false;
  for (var dbTry = 1; dbTry <= 3; dbTry++) {
    dbHealthy = await db.healthCheck();
    if (dbHealthy) break;
    console.error(`  [DB] 连接失败，第 ${dbTry} 次重试...`);
    await new Promise(r => setTimeout(r, 3000));
  }
  if (!dbHealthy) {
    console.error('❌ 数据库连续 3 次连接失败，任务终止');
    clearTimeout(timeoutHandle);
    process.exit(1);
  }
  console.log('✅ 数据库连接正常');

  // 2. 确定项目列表 — 从关注列表读取
  let projectList;

  if (isTest || config.crawl.mode === 'test') {
    projectList = config.sampleProjects.map(p => ({
      project_id: p.projectID,
      name: p.name,
    }));
  } else {
    // 从 watched_projects 读取启用的关注项目
    projectList = await db.query(`
      SELECT w.project_id, p.name
      FROM watched_projects w
      JOIN projects p ON w.project_id = p.project_id
      WHERE w.is_active = 1
      ORDER BY p.last_crawl ASC
    `);

    if (projectList.length === 0) {
      console.log('  ⚠️  关注列表为空！请通过 /api/watchlist 添加关注项目');
      console.log('  示例: POST /api/watchlist {"project_id":"8205387","name":"金阙华院"}');
      console.log('  或使用 --test 模式先跑样本项目验证\n');
      clearTimeout(timeoutHandle);
      process.exit(0);
    }
  }

  // 追加历史失败的项目（如果存在且未超过 3 天）
  var failedData = loadFailedProjects();
  if (failedData.projects && failedData.projects.length > 0) {
    var recentFailures = failedData.projects.filter(function(fp) {
      if (!fp.lastAttempt) return true;
      var diffDays = (new Date(today) - new Date(fp.lastAttempt)) / 86400000;
      return diffDays <= 3;
    });
    if (recentFailures.length > 0) {
      console.log(`\n🔄 发现 ${recentFailures.length} 个历史失败项目，加入重试列表`);
      recentFailures.forEach(function(fp) {
        if (!projectList.find(function(p) { return p.project_id === fp.project_id; })) {
          projectList.push({ project_id: fp.project_id, name: fp.name || fp.project_id });
        }
      });
    }
  }

  console.log(`\n📋 待爬取项目: ${projectList.length} 个`);
  projectList.forEach((p, i) => {
    console.log(`   ${i + 1}. ${p.name} (${p.project_id})`);
  });

  // 3. 逐项目执行，单项目失败不中断
  var successCount = 0;
  var failCount = 0;
  var skipCount = 0;
  var failedProjects = [];

  for (var i = 0; i < projectList.length; i++) {
    if (jobTimedOut) break;

    var proj = projectList[i];
    console.log(`\n[${i + 1}/${projectList.length}] 开始: ${proj.name} (${proj.project_id})`);

    try {
      // 单项目超时（30 分钟）
      var projectTimedOut = false;
      var projTimer = setTimeout(function() {
        projectTimedOut = true;
        console.error(`  ⏰ 项目 ${proj.project_id} 超时（30分钟），跳过`);
      }, 30 * 60 * 1000);

      await crawlProjects([proj]);
      clearTimeout(projTimer);

      if (projectTimedOut) {
        skipCount++;
        failedProjects.push({ project_id: proj.project_id, name: proj.name, reason: 'timeout' });
        continue;
      }

      // 成功：从失败列表移除
      removeFromFailed(proj.project_id);
      successCount++;

      console.log(`  ✅ 完成 (${i + 1}/${projectList.length})`);
    } catch (err) {
      failCount++;
      console.error(`  ❌ 失败: ${err.message}`);

      failedProjects.push({
        project_id: proj.project_id,
        name: proj.name,
        reason: err.message.slice(0, 200),
        lastAttempt: today,
      });

      // 继续下一个，不中断
      console.log(`  继续下一个项目...\n`);
    }
  }

  // 保存失败项目列表（下次自动重试）
  if (failedProjects.length > 0) {
    var existing = loadFailedProjects();
    // 合并：保留历史失败 + 本次失败，去重
    var merged = [].concat(existing.projects);
    failedProjects.forEach(function(fp) {
      if (!merged.find(function(m) { return m.project_id === fp.project_id; })) {
        merged.push(fp);
      }
    });
    saveFailedProjects({ projects: merged, lastCleanup: today });
    console.log(`\n💾 ${failedProjects.length} 个失败项目已保存，下次任务自动重试`);
  }

  clearTimeout(timeoutHandle);

  // 4. 输出汇总
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  var todaySnapshots = 0, todayChanges = 0;
  try {
    var snapResult = await db.queryOne(
      'SELECT COUNT(*) as count FROM daily_snapshots WHERE snapshot_date = ?',
      [today]
    );
    todaySnapshots = snapResult ? snapResult.count : 0;

    var changeResult = await db.queryOne(
      'SELECT COUNT(*) as count FROM daily_changes WHERE change_date = ?',
      [today]
    );
    todayChanges = changeResult ? changeResult.count : 0;
  } catch (e) {
    console.error('统计查询失败:', e.message);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 当日任务汇总`);
  console.log(`${'='.repeat(50)}`);
  console.log(`  成功: ${successCount}  失败: ${failCount}  跳过: ${skipCount}`);
  console.log(`  快照数: ${todaySnapshots}`);
  console.log(`  变化数: ${todayChanges}`);
  console.log(`  耗时: ${elapsed} 分钟`);
  if (failedProjects.length > 0) {
    console.log(`  失败项目: ${failedProjects.map(function(p) { return p.project_id; }).join(', ')}`);
  }
  console.log(`${'='.repeat(50)}\n`);

  // 写入 crawl_logs
  await db.insert(
    'INSERT INTO crawl_logs (crawl_date, phase, project_id, status, message) VALUES (?, ?, ?, ?, ?)',
    [today, 'complete', '', failCount > 0 ? 'partial' : 'success',
     '成功:' + successCount + ' 失败:' + failCount + ' 快照:' + todaySnapshots]
  ).catch(function(){});

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('任务异常退出:', err);
  process.exit(1);
});
