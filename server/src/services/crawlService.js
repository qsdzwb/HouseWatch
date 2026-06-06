const { crawlListPage } = require('../crawler/crawlListPage');
const { crawlDetailPage } = require('../crawler/crawlDetailPage');
const { crawlUnitTable } = require('../crawler/crawlUnitTable');
const { crawlHouseDetail } = require('../crawler/crawlHouseDetail');
const { closeBrowser } = require('../crawler/browser');
const db = require('../db/pool');
const config = require('../config');
const snapshotService = require('./snapshotService');

/**
 * 爬虫编排服务：协调4层爬虫并写入数据库
 */

// 辅助：提取数值
function parseNum(str) {
  if (!str) return null;
  const match = String(str).match(/(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * 爬取单个项目的完整流程
 */
async function crawlSingleProject(projectId, projectName) {
  const today = new Date().toISOString().split('T')[0];

  console.log(`\n${'='.repeat(50)}`);
  console.log(`项目: ${projectName} (${projectId})`);
  console.log(`${'='.repeat(50)}`);

  // 1. 获取楼栋列表 + 项目成交数据 (Layer 2)
  let buildings;
  let projectStats = null;
  try {
    const result = await crawlDetailPage(projectId);
    buildings = result.buildings;
    projectStats = result.projectStats;
  } catch (err) {
    console.error(`  详情页爬取失败: ${err.message}`);
    await db.insert(
      'INSERT INTO crawl_logs (crawl_date, phase, project_id, status, message) VALUES (?, ?, ?, ?, ?)',
      [today, 'detail', projectId, 'fail', err.message]
    );
    return;
  }

  // 保存项目成交数据到 project_daily_stats
  if (projectStats && (projectStats.signedCount > 0 || projectStats.avgPrice > 0)) {
    try {
      await db.query(
        `INSERT INTO project_daily_stats 
          (project_id, stat_date, signed_count, signed_area, avg_price)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, stat_date) DO UPDATE SET
          signed_count = excluded.signed_count,
          signed_area = excluded.signed_area,
          avg_price = excluded.avg_price`,
        [projectId, today, projectStats.signedCount, projectStats.signedArea, projectStats.avgPrice]
      );
      console.log(`  [Layer 2] 已保存项目日统计: ${projectId} ${today}`);
    } catch (err) {
      console.error(`  保存项目日统计失败: ${err.message}`);
    }

    // 同时更新 projects 表的累计数据
    await db.query(
      `UPDATE projects SET 
        signed_count = ?, signed_area = ?, avg_price = ?, last_crawl = ?
       WHERE project_id = ?`,
      [projectStats.signedCount, projectStats.signedArea, projectStats.avgPrice, today, projectId]
    );
  }

  if (buildings.length === 0) {
    console.log('  未发现楼栋，跳过');
    return;
  }

  // 保存/更新项目
  await db.upsert('projects', {
    project_id: projectId,
    name: projectName,
    last_crawl: today,
  }, 'project_id');

  // 2. 遍历每个楼栋
  for (const building of buildings) {
    console.log(`\n  楼栋: ${building.buildingName} (${building.buildingId})`);

    // 保存楼栋
    await db.upsert('buildings', {
      project_id: projectId,
      building_id: building.buildingId,
      building_name: building.buildingName,
      sale_permit_id: building.salePermitId || '',
    }, 'building_id');

    // 3. 获取楼盘表数据 (Layer 3)
    let units;
    try {
      units = await crawlUnitTable(building.buildingId, building.salePermitId);
    } catch (err) {
      console.error(`    楼盘表爬取失败: ${err.message}`);
      continue;
    }

    // 更新楼栋总套数
    await db.insert(
      'UPDATE buildings SET total_units = ?, updated_at = datetime(\'now\',\'localtime\') WHERE building_id = ?',
      [units.length, building.buildingId]
    );

    // 4. 遍历每套房
    const houseIdsToday = [];
    let detailCount = 0;

    for (const unit of units) {
      // 保存/更新房屋基本信息
      const houseData = {
        house_id: unit.houseId || `${building.buildingId}_${unit.roomNo}`,
        building_id: building.buildingId,
        room_no: unit.roomNo,
        status: unit.status || '未知',
      };

      await db.upsert('houses', houseData, 'house_id');
      houseIdsToday.push(houseData.house_id);

      // 如果有详情链接，爬取 Layer 4
      if (unit.houseId) {
        try {
          const detail = await crawlHouseDetail(unit.houseId, building.salePermitId);
          detailCount++;

          if (detail && detail.buildArea) {
            const buildArea = parseNum(detail.buildArea);
            const innerArea = parseNum(detail.innerArea);
            const pricePerSqm = parseNum(detail.pricePerSqM);

            const updateData = {
              purpose: detail.purpose || null,
              layout: detail.layout || null,
              build_area: buildArea,
              inner_area: innerArea,
              list_price_per_sqm: pricePerSqm,
              list_total_price: buildArea && pricePerSqm ? buildArea * pricePerSqm : null,
              status: houseData.status,
            };

            // 更新房屋详情
            await db.insert(
              `UPDATE houses SET 
                purpose = ?, layout = ?, build_area = ?, inner_area = ?,
                list_price_per_sqm = ?, list_total_price = ?, status = ?,
                updated_at = datetime('now','localtime')
              WHERE house_id = ?`,
              [
                updateData.purpose, updateData.layout, updateData.build_area,
                updateData.inner_area, updateData.list_price_per_sqm,
                updateData.list_total_price, updateData.status, unit.houseId,
              ]
            );
          }

          if (detailCount % 5 === 0) {
            console.log(`    已获取 ${detailCount}/${units.filter(u => u.houseId).length} 套详情`);
          }
        } catch (err) {
          console.error(`    房屋 ${unit.roomNo} 详情获取失败: ${err.message}`);
        }
      }
    }

    console.log(`  ✅ 楼栋完成: ${units.length} 套房, ${detailCount} 套详情`);

    // 5. 写入日快照 (批量)
    const snapshots = houseIdsToday.map(hid => ({
      house_id: hid,
      snapshot_date: today,
      status: units.find(u => (u.houseId || `${building.buildingId}_${u.roomNo}`) === hid)?.status || '未知',
      list_price_per_sqm: null,
      build_area: null,
    }));

    if (snapshots.length > 0) {
      await db.batchInsert('daily_snapshots', snapshots, [
        'house_id', 'snapshot_date', 'status', 'list_price_per_sqm', 'build_area',
      ]);
    }
  }

  // 日志
  await db.insert(
    'INSERT INTO crawl_logs (crawl_date, phase, project_id, status, message) VALUES (?, ?, ?, ?, ?)',
    [today, 'complete', projectId, 'success', `${buildings.length} 楼栋已完成`]
  );

  console.log(`✅ 项目 ${projectName} 完成`);
}

/**
 * 批量爬取项目列表
 */
async function crawlProjects(projectList) {
  const today = new Date().toISOString().split('T')[0];

  console.log(`\n🏗️  开始爬取 ${projectList.length} 个项目 (${today})`);

  await db.insert(
    'INSERT INTO crawl_logs (crawl_date, phase, project_id, status, message) VALUES (?, ?, ?, ?, ?)',
    [today, 'start', '', 'start', `${projectList.length} 个项目待爬取`]
  );

  for (let i = 0; i < projectList.length; i++) {
    const proj = projectList[i];
    console.log(`\n[${i + 1}/${projectList.length}]`);
    try {
      await crawlSingleProject(proj.project_id || proj.projectID, proj.name);
    } catch (err) {
      console.error(`❌ 项目 ${proj.name} 失败: ${err.message}`);
    }
  }

  // 执行差值分析
  console.log('\n📊 执行差值分析...');
  const changeCount = await snapshotService.analyzeDailyChanges(today);
  console.log(`✅ 差值分析完成，发现 ${changeCount} 条变化`);

  // 关闭浏览器
  await closeBrowser();

  console.log(`\n🎉 当日爬取完成! ${today}`);
  return changeCount;
}

module.exports = { crawlSingleProject, crawlProjects };
