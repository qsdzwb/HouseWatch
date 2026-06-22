/**
 * 批量爬取房源详情脚本
 *
 * 功能：
 * 1. 重新爬取楼盘表页面，提取所有可售房源的真实 houseId（纯数字）
 * 2. 批量爬取房源详情页（用途、户型、面积、单价）
 * 3. 存入数据库，避免房源售后无法获取详情
 *
 * 用法：
 *   node server/scripts/batchCrawlDetails.js           # 只跑关注楼盘（display_name 非空）
 *   node server/scripts/batchCrawlDetails.js --all     # 跑所有楼盘
 *   node server/scripts/batchCrawlDetails.js --project 9  # 跑指定项目
 *   node server/scripts/batchCrawlDetails.js --building 577199  # 跑指定楼栋
 */

const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

// ── 加载 .env ───────────────────────────────────────
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    // 远端路径：scripts/../.env
    const altPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(altPath)) {
      loadEnvFromFile(altPath);
      return;
    }
    return;
  }
  loadEnvFromFile(envPath);
}

function loadEnvFromFile(envPath) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    process.env[key] = val;
  }
}

loadEnv();

// ── 数据库路径 ──────────────────────────────────────
function getDbPath() {
  if (process.env.DB_SQLITE_PATH) {
    // DB_SQLITE_PATH 是相对于项目根目录的
    return path.resolve(__dirname, '..', process.env.DB_SQLITE_PATH);
  }
  return path.join(__dirname, '../data/bj_realestate.db');
}

// ── 数据库连接 ─────────────────────────────────────────
function getDb() {
  const dbPath = getDbPath();
  console.log(`  📁 数据库: ${dbPath}`);
  const db = new Database(dbPath);
  return db;
}

// ── 延迟函数 ──────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── 爬取楼盘表，提取可售房源真实 houseId ─────────────
async function crawlBuildingForRealIds(buildingId, salePermitId) {
  const { newPage } = require('../src/crawler/browser');
  const pageUrl = (process.env.CRAWL_PAGE_URL || 'http://bjjs.zjw.beijing.gov.cn/eportal/ui').replace(/\/$/, '');
  const url = `${pageUrl}?pageId=320833&systemId=2&categoryId=1&salePermitId=${salePermitId}&buildingId=${buildingId}`;

  try {
    console.log(`  📋 爬取楼盘表: buildingId=${buildingId}`);
    const page = await newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(8000);

    const result = await page.evaluate(() => {
      const map = {};  // roomNo -> realHouseId

      // 查找所有含 houseId 的链接（可售房源）
      const links = document.querySelectorAll('a[href*="houseId"]');
      links.forEach(link => {
        const href = link.href || '';
        const match = href.match(/[?&]houseId=(\d+)/);
        if (match) {
          const realHouseId = match[1];
          const roomNo = (link.innerText || link.textContent || '').trim();
          if (roomNo && !map[roomNo]) {
            map[roomNo] = realHouseId;
          }
        }
      });

      return map;
    });

    const count = Object.keys(result).length;
    if (count > 0) {
      console.log(`  ✅ 提取到 ${count} 个真实 houseId`);
    } else {
      console.log(`  ⚠️  未提取到真实 houseId（可能该楼栋无可售房源）`);
    }
    await page.close();
    return result;
  } catch (err) {
    console.error(`  ❌ 楼盘表爬取失败: ${err.message}`);
    return {};
  }
}

// ── 爬取单个房源详情 ──────────────────────────────────
async function crawlOneDetail(realHouseId, salePermitId) {
  const { crawlHouseDetail } = require('../src/crawler/crawlHouseDetail');
  try {
    const detail = await crawlHouseDetail(realHouseId, salePermitId);
    return detail;
  } catch (err) {
    return null;
  }
}

// ── 主流程 ─────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const isAll = args.includes('--all');
  let projectIds = [];
  let buildingIds = [];

  // 解析参数（支持 --key=value 和 --key value 两种格式）
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--project=')) {
      projectIds.push(arg.split('=')[1].trim());
    } else if (arg === '--project' && i + 1 < args.length) {
      projectIds.push(args[++i].trim());
    } else if (arg.startsWith('--building=')) {
      buildingIds.push(arg.split('=')[1].trim());
    } else if (arg === '--building' && i + 1 < args.length) {
      buildingIds.push(args[++i].trim());
    }
  }

  const db = getDb();

  // 查询要处理的楼栋
  let buildings = [];

  if (buildingIds.length > 0) {
    const placeholders = buildingIds.map(() => '?').join(',');
    buildings = db.prepare(
      `SELECT building_id, sale_permit_id FROM buildings WHERE building_id IN (${placeholders})`
    ).all(...buildingIds);
  } else if (projectIds.length > 0) {
    const placeholders = projectIds.map(() => '?').join(',');
    buildings = db.prepare(
      `SELECT building_id, sale_permit_id FROM buildings WHERE project_id IN (${placeholders})`
    ).all(...projectIds);
  } else if (isAll) {
    buildings = db.prepare('SELECT building_id, sale_permit_id FROM buildings').all();
  } else {
    // 默认：只跑关注楼盘（display_name 非空）
    buildings = db.prepare(`
      SELECT b.building_id, b.sale_permit_id
      FROM buildings b
      JOIN projects p ON b.project_id = p.id
      WHERE p.display_name IS NOT NULL AND p.display_name != ''
    `).all();
  }

  if (buildings.length === 0) {
    console.log('⚠️  未找到匹配的楼栋，请检查参数');
    db.close();
    return;
  }

  console.log(`\n🏗️  共 ${buildings.length} 个楼栋待处理\n`);
  console.log('（每个楼栋间延迟 5 秒，每套房延迟 3 秒，请耐心等待）\n');

  let totalHouses = 0;
  let updatedHouses = 0;
  let errorCount = 0;
  let start = Date.now();

  for (const [idx, bld] of buildings.entries()) {
    console.log(`\n[${idx + 1}/${buildings.length}] 楼栋 ${bld.building_id}`);

    // 步骤1：爬取楼盘表，获取真实 houseId
    const realIdMap = await crawlBuildingForRealIds(bld.building_id, bld.sale_permit_id);
    await sleep(2000);

    if (Object.keys(realIdMap).length === 0) {
      console.log(`  ⚠️  无真实 houseId，跳过此楼栋`);
      if (idx < buildings.length - 1) await sleep(5000);
      continue;
    }

    // 步骤2：更新数据库中的 real_house_id（灵活匹配 room_no）
    const housesInBld = db.prepare(
      'SELECT house_id, room_no FROM houses WHERE building_id = ?'
    ).all(bld.building_id);

    const updateRealId = db.prepare(
      'UPDATE houses SET real_house_id = ? WHERE house_id = ?'
    );
    let realIdCount = 0;

    for (const h of housesInBld) {
      let realHouseId = null;

      // 方式1：精确匹配 room_no
      if (realIdMap[h.room_no]) {
        realHouseId = realIdMap[h.room_no];
      } else {
        // 方式2：提取 room_no 末尾的数字部分进行匹配
        const roomNumMatch = h.room_no.match(/(\d+)$/);
        if (roomNumMatch) {
          const roomNum = roomNumMatch[1];
          for (const [pageRoomNo, rid] of Object.entries(realIdMap)) {
            // pageRoomNo 可能是 "801"，roomNum 是 "801"
            if (pageRoomNo === roomNum || pageRoomNo.includes(roomNum) || roomNum.includes(pageRoomNo)) {
              realHouseId = rid;
              break;
            }
          }
        }
      }

      if (realHouseId) {
        const result = updateRealId.run(realHouseId, h.house_id);
        if (result.changes > 0) realIdCount++;
      }
    }
    console.log(`  💾 已更新 ${realIdCount} 条 real_house_id`);

    // 步骤3：批量爬取详情（只爬还没有详情数据的）
    const housesToCrawl = db.prepare(`
      SELECT house_id, real_house_id
      FROM houses
      WHERE building_id = ? AND real_house_id IS NOT NULL
        AND (purpose IS NULL OR layout IS NULL OR build_area IS NULL)
    `).all(bld.building_id);

    if (housesToCrawl.length === 0) {
      console.log(`  ✅ 该楼栋所有房源已有详情数据，跳过`);
      if (idx < buildings.length - 1) await sleep(3000);
      continue;
    }

    console.log(`  🔍 需爬取详情: ${housesToCrawl.length} 套`);

    for (const [i, house] of housesToCrawl.entries()) {
      totalHouses++;
      const pct = (((i + 1) / housesToCrawl.length) * 100).toFixed(0);
      process.stdout.write(
        `\r  [${i + 1}/${housesToCrawl.length}] (${pct}%) houseId=${house.real_house_id}...`
      );

      const detail = await crawlOneDetail(house.real_house_id, bld.sale_permit_id);
      await sleep(3000);

      if (detail && (detail.purpose || detail.layout || detail.buildArea)) {
        const buildAreaMatch = String(detail.buildArea || '').match(/([\d.]+)/);
        const innerAreaMatch = String(detail.innerArea || '').match(/([\d.]+)/);
        const pricePerSqmMatch = String(detail.pricePerSqM || '').match(/([\d.]+)/);

        db.prepare(`
          UPDATE houses SET
            purpose = COALESCE(?, purpose),
            layout = COALESCE(?, layout),
            build_area = COALESCE(?, build_area),
            inner_area = COALESCE(?, inner_area),
            list_price_per_sqm = COALESCE(?, list_price_per_sqm),
            updated_at = datetime('now','localtime')
          WHERE house_id = ?
        `).run(
          detail.purpose || null,
          detail.layout || null,
          buildAreaMatch ? parseFloat(buildAreaMatch[1]) : null,
          innerAreaMatch ? parseFloat(innerAreaMatch[1]) : null,
          pricePerSqmMatch ? parseFloat(pricePerSqmMatch[1]) : null,
          house.house_id
        );

        updatedHouses++;
        const msg = `用途=${detail.purpose || '-'} 户型=${detail.layout || '-'} ${detail.buildArea || '-'}m²`;
        process.stdout.write(`\r  [${i + 1}/${housesToCrawl.length}] ✅ ${msg}\n`);
      } else {
        errorCount++;
        process.stdout.write(`\r  [${i + 1}/${housesToCrawl.length}] ❌ 无数据\n`);
      }
    }

    if (idx < buildings.length - 1) {
      console.log(`  ⏳ 等待 5 秒后处理下一个楼栋...`);
      await sleep(5000);
    }
  }

  db.close();
  const elapsed = Math.round((Date.now() - start) / 1000);

  console.log(`\n\n${'='.repeat(50)}`);
  console.log(`✅ 批量爬取完成！用时 ${elapsed} 秒`);
  console.log(`${'='.repeat(50)}`);
  console.log(`   处理楼栋: ${buildings.length}`);
  console.log(`   爬取房源: ${totalHouses} 套`);
  console.log(`   成功更新: ${updatedHouses} 套`);
  console.log(`   失败/无数据: ${errorCount} 套`);
  console.log(`${'='.repeat(50)}\n`);
}

main().catch(err => {
  console.error('\n❌ 脚本执行失败:', err);
  process.exit(1);
});
