/**
 * 批量预爬房屋详情脚本 v2
 *
 * 背景：小程序用户点击房屋时，后端会实时爬取住建委房屋详情页（用途/户型/面积等）
 *        本脚本在后台预先跑一遍，把所有房屋的详情数据提前写入 DB，
 *        用户点击时直接读库，无需等待爬取。
 *
 * 两阶段：
 *   Phase 1 — 从楼栋楼盘表页提取真实 houseId（real_house_id 映射）
 *   Phase 2 — 对缺少详情数据的房屋，逐个爬取住建委房屋详情页
 *
 * 用法（在服务器上，server/ 目录下运行）：
 *   node scripts/batchCrawlDetailsV2.js                  # 增量跑关注楼盘（默认只爬「可售」状态）
 *   node scripts/batchCrawlDetailsV2.js --all             # 跑所有楼盘
 *   node scripts/batchCrawlDetailsV2.js --project 8205387  # 跑指定项目
 *   node scripts/batchCrawlDetailsV2.js --building 577656  # 跑指定楼栋
 *   node scripts/batchCrawlDetailsV2.js --dry-run          # 只预览不执行
 *   node scripts/batchCrawlDetailsV2.js --force            # 强制重爬已有数据
 *   node scripts/batchCrawlDetailsV2.js --all-status      # 爬所有状态（不只是「可售」）
 *   node scripts/batchCrawlDetailsV2.js --no-browser      # 跳过 Phase2（只跑 Phase1）
 *
 * 注意：只有「可售」状态的房源才能查看房屋详细信息（用途/户型/面积等），
 *       非可售状态的房屋住建委不提供详情页，爬取会返回 404。
 *       默认只爬可售状态，用 --all-status 可跳过此过滤（用于测试）。
 */

const path = require('path');
const fs = require('fs');

// ── 加载 .env ────────────────────────────────────────
function loadEnv() {
  const envPaths = [
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../.env'),
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) { loadEnvFromFile(envPath); return; }
  }
}
function loadEnvFromFile(envPath) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    let val = trimmed.substring(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadEnv();

// ── 解析命令行参数 ───────────────────────────────────
const options = {
  all: false,
  projectIds: [],
  buildingIds: [],
  dryRun: false,
  force: false,
  noBrowser: false,
  onlyAvailable: true,  // 默认只爬「可售」状态的房屋（只有可售状态才有详情页）
};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--all') options.all = true;
  else if (a === '--dry-run' || a === '--dryRun') options.dryRun = true;
  else if (a === '--force') options.force = true;
  else if (a === '--no-browser') options.noBrowser = true;
  else if (a === '--all-status') options.onlyAvailable = false;  // 爬所有状态（不只是可售）
  else if (a === '--project' && args[i + 1]) { options.projectIds.push(args[++i]); }
  else if (a === '--building' && args[i + 1]) { options.buildingIds.push(args[++i]); }
  else if (!a.startsWith('--')) {
    // 位置参数：默认当作 building_id
    options.buildingIds.push(a);
  }
}

// ── 依赖（延迟加载）──────────────────────────────────
let db, browser;
function getDb() {
  if (!db) {
    // 使用服务端的 pool 模块（与线上代码一致）
    const pool = require('../src/db/pool');
    db = pool;
  }
  return db;
}
async function getBrowser() {
  if (browser && browser.connected) return browser;
  const puppeteer = require('puppeteer');
  const launchOpts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  };
  const chromePath = process.env.CRAWL_CHROME_PATH;
  if (chromePath) launchOpts.executablePath = chromePath;
  browser = await puppeteer.launch(launchOpts);
  console.log('[BR] Chrome 已启动');
  return browser;
}
async function newPage() {
  const b = await getBrowser();
  const page = await b.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1920, height: 1080 });
  return page;
}
async function closeBrowser() {
  if (browser && browser.connected) {
    await browser.close();
    browser = null;
    console.log('[BR] Chrome 已关闭');
  }
}

// ── 工具 ─────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(tag, msg) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${ts}] [${tag}] ${msg}`);
}

// ═══════════════════════════════════════════════════════
//  Phase 1：从楼盘表页提取真实 houseId
// ═══════════════════════════════════════════════════════
async function runPhase1(buildings) {
  log('P1', `开始 Phase 1：提取真实 houseId（共 ${buildings.length} 个楼栋）`);
  let totalMatched = 0;

  for (const [idx, bld] of buildings.entries()) {
    log('P1', `[${idx + 1}/${buildings.length}] ${bld.building_name} (${bld.building_id})`);

    if (!bld.sale_permit_id) {
      log('P1', `  ⚠️  缺少 sale_permit_id，跳过`);
      continue;
    }

    // 爬取楼盘表页，提取 roomNo → realHouseId 映射
    const realIdMap = await crawlBuildingPage(bld.building_id, bld.sale_permit_id);
    if (Object.keys(realIdMap).length === 0) {
      log('P1', `  ⚠️  未提取到任何真实 houseId`);
      continue;
    }

    // 写入 DB
    const matched = syncRealIds(realIdMap, bld.building_id);
    totalMatched += matched;

    // 礼貌延迟
    await sleep(1500);
  }

  log('P1', `✅ Phase 1 完成：共匹配 ${totalMatched} 个真实 houseId`);
  return totalMatched;
}

/**
 * 访问楼栋楼盘表页（pageId=320833），提取所有可售房源的真实 houseId
 */
async function crawlBuildingPage(buildingId, salePermitId) {
  const baseUrl = (process.env.CRAWL_PAGE_URL || 'http://bjjs.zjw.beijing.gov.cn/eportal/ui').replace(/\/$/, '');
  const url = `${baseUrl}?pageId=320833&systemId=2&categoryId=1&salePermitId=${salePermitId}&buildingId=${buildingId}`;

  let page;
  try {
    page = await newPage();
    log('P1', `  📋 访问楼盘表: ${url}`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(8000);

    const result = await page.evaluate(() => {
      const map = {};

      // 方法1：直接找含 houseId 的链接
      document.querySelectorAll('a[href*="houseId"]').forEach(link => {
        const href = link.href || '';
        const m = href.match(/[?&]houseId=(\d+)/);
        if (m) {
          const roomNo = (link.innerText || link.textContent || '').trim();
          if (roomNo) map[roomNo] = m[1];
        }
      });

      // 方法2：找可点击的房间单元格（含链接的 td/div）
      document.querySelectorAll('td[onclick*="houseId"], div[onclick*="houseId"]').forEach(el => {
        const onclick = el.getAttribute('onclick') || '';
        const m = onclick.match(/houseId[=:](\d+)/);
        if (m) {
          const roomNo = (el.innerText || el.textContent || '').trim();
          if (roomNo && !map[roomNo]) map[roomNo] = m[1];
        }
      });

      return map;
    });

    await page.close();
    log('P1', `  ✅ 提取到 ${Object.keys(result).length} 个映射`);
    return result;
  } catch (err) {
    if (page) try { await page.close(); } catch (_) {}
    log('P1', `  ❌ 失败: ${err.message}`);
    return {};
  }
}

/**
 * 将真实 houseId 映射同步到 DB
 */
function syncRealIds(realIdMap, buildingId) {
  const db = getDb();
  const houses = db.query(
    'SELECT house_id, room_no, real_house_id FROM houses WHERE building_id = ?',
    [buildingId]
  );

  let matched = 0;
  for (const h of houses) {
    if (h.real_house_id && !options.force) continue;

    let realHouseId = null;

    // 策略1：精确匹配
    if (realIdMap[h.room_no]) {
      realHouseId = realIdMap[h.room_no];
    } else {
      // 策略2：房号尾部数字匹配
      const tailNum = h.room_no.match(/(\d+)$/);
      if (tailNum) {
        const num = tailNum[1];
        for (const [pageRoom, rid] of Object.entries(realIdMap)) {
          if (pageRoom === num || pageRoom.endsWith(num) || num.endsWith(pageRoom)) {
            realHouseId = rid; break;
          }
        }
      }
      // 策略3：去掉非数字前缀后匹配
      if (!realHouseId) {
        const cleanRoom = h.room_no.replace(/^\D+/, '');
        for (const [pageRoom, rid] of Object.entries(realIdMap)) {
          const cleanPage = pageRoom.replace(/^\D+/, '');
          if (cleanRoom === cleanPage) { realHouseId = rid; break; }
        }
      }
    }

    if (realHouseId) {
      db.run(
        'UPDATE houses SET real_house_id = ?, updated_at = datetime(\'now\',\'localtime\') WHERE house_id = ?',
        [realHouseId, h.house_id]
      );
      matched++;
    }
  }

  log('P1', `  💾 新匹配 ${matched}/${houses.length} 套`);
  return matched;
}

// ═══════════════════════════════════════════════════════
//  Phase 2：批量爬取房屋详情
// ═══════════════════════════════════════════════════════
async function runPhase2(buildings) {
  log('P2', `开始 Phase 2：爬取房屋详情（共 ${buildings.length} 个楼栋）`);

  // 加载 crawlHouseDetail 函数
  const { crawlHouseDetail } = require('../src/crawler/crawlHouseDetail');

  let totalToCrawl = 0;
  let updated = 0;
  let failed = 0;
  let noData = 0;

  for (const [idx, bld] of buildings.entries()) {
    log('P2', `[${idx + 1}/${buildings.length}] ${bld.building_name} (${bld.building_id})`);

    // 查询需要爬取的房屋
    let sql, params;
    const statusFilter = options.onlyAvailable ? " AND status = '可售'" : '';
    if (options.force) {
      sql = `
        SELECT house_id, real_house_id, room_no, status
        FROM houses
        WHERE building_id = ? AND real_house_id IS NOT NULL${statusFilter}
      `;
      params = [bld.building_id];
    } else {
      sql = `
        SELECT house_id, real_house_id, room_no, status
        FROM houses
        WHERE building_id = ? AND real_house_id IS NOT NULL
          AND (purpose IS NULL OR layout IS NULL OR build_area IS NULL)${statusFilter}
      `;
      params = [bld.building_id];
    }

    const housesToCrawl = getDb().query(sql, params);

    if (housesToCrawl.length === 0) {
      // 区分是「没有可售房屋」还是「已有完整数据」
      const totalInBld = getDb().query(
        'SELECT COUNT(*) as c, SUM(CASE WHEN status = \'可售\' THEN 1 ELSE 0 END) as available FROM houses WHERE building_id = ?',
        [bld.building_id]
      )[0];
      if (options.onlyAvailable && totalInBld.available === 0) {
        log('P2', `  ⏭️  跳过（该楼栋无可售房屋，非可售状态无法查看详情）`);
      } else {
        log('P2', `  ⏭️  无需爬取（已有完整数据或缺少 real_house_id）`);
      }
      continue;
    }

    log('P2', `  📊 待爬取: ${housesToCrawl.length} 套`);
    totalToCrawl += housesToCrawl.length;

    for (const [hIdx, house] of housesToCrawl.entries()) {
      log('P2', `    [${hIdx + 1}/${housesToCrawl.length}] ${house.room_no} (realId=${house.real_house_id})`);

      if (options.dryRun) {
        log('P2', `    🔍 [dry-run] 将爬取 houseId=${house.real_house_id}`);
        continue;
      }

      try {
        const detail = await crawlHouseDetail(house.real_house_id, bld.sale_permit_id);

        if (detail && (detail.purpose || detail.layout || detail.buildArea)) {
          // 解析数值
          const buildAreaMatch = String(detail.buildArea || '').match(/([\d.]+)/);
          const innerAreaMatch = String(detail.innerArea || '').match(/([\d.]+)/);
          const priceMatch = String(detail.pricePerSqM || '').match(/([\d.]+)/);

          getDb().run(
            `UPDATE houses SET
              purpose = COALESCE(?, purpose),
              layout = COALESCE(?, layout),
              build_area = COALESCE(?, build_area),
              inner_area = COALESCE(?, inner_area),
              list_price_per_sqm = COALESCE(?, list_price_per_sqm),
              updated_at = datetime('now','localtime')
             WHERE house_id = ?`,
            [
              detail.purpose || null,
              detail.layout || null,
              buildAreaMatch ? parseFloat(buildAreaMatch[1]) : null,
              innerAreaMatch ? parseFloat(innerAreaMatch[1]) : null,
              priceMatch ? parseFloat(priceMatch[1]) : null,
              house.house_id,
            ]
          );
          updated++;
          log('P2', `    ✅ ${detail.purpose || ''} ${detail.layout || ''} 建面=${detail.buildArea || '-'}`);
        } else {
          noData++;
          log('P2', `    ⚠️  未获取到详情数据（该房屋可能已签约/不可售）`);
        }
      } catch (err) {
        failed++;
        log('P2', `    ❌ 爬取失败: ${err.message}`);
      }

      // 每套之间延迟，避免被限速
      await sleep(2000);
    }

    // 每个楼栋之间延迟
    await sleep(3000);
  }

  log('P2', `✅ Phase 2 完成：待爬=${totalToCrawl}, 成功=${updated}, 失败=${failed}, 无数据=${noData}`);
}

// ═══════════════════════════════════════════════════════
//  主流程
// ═══════════════════════════════════════════════════════
async function main() {
  const startTime = Date.now();

  log('MAIN', '🚀 批量预爬房屋详情 v2 启动');
  log('MAIN', `模式: ${options.all ? '全部楼盘' : '关注楼盘'} | dryRun=${options.dryRun} | force=${options.force}`);

  // 确保 DB schema 最新（添加 real_house_id 列）
  const db = getDb();
  const cols = db.query('PRAGMA table_info(houses)');
  const hasRealId = cols.some(c => c.name === 'real_house_id');
  if (!hasRealId) {
    log('MAIN', '🔧 自动迁移：添加 real_house_id 列');
    db.run('ALTER TABLE houses ADD COLUMN real_house_id TEXT');
  }

  // 查询要处理的楼栋
  let buildings;
  if (options.buildingIds.length > 0) {
    const placeholders = options.buildingIds.map(() => '?').join(',');
    buildings = db.query(
      `SELECT b.building_id, b.building_name, b.sale_permit_id, b.project_id
       FROM buildings b
       WHERE b.building_id IN (${placeholders})`,
      options.buildingIds
    );
  } else if (options.projectIds.length > 0) {
    const placeholders = options.projectIds.map(() => '?').join(',');
    buildings = db.query(
      `SELECT b.building_id, b.building_name, b.sale_permit_id, b.project_id
       FROM buildings b
       WHERE b.project_id IN (${placeholders})`,
      options.projectIds
    );
  } else if (options.all) {
    buildings = db.query(
      'SELECT building_id, building_name, sale_permit_id, project_id FROM buildings'
    );
  } else {
    // 默认：只跑关注楼盘
    buildings = db.query(`
      SELECT b.building_id, b.building_name, b.sale_permit_id, b.project_id
      FROM buildings b
      JOIN watched_projects wp ON b.project_id = wp.project_id
      WHERE wp.is_active = 1
    `);
  }

  if (buildings.length === 0) {
    log('MAIN', '⚠️  没有找到符合条件的楼栋，退出');
    process.exit(0);
  }

  log('MAIN', `📋 共 ${buildings.length} 个楼栋待处理`);

  if (options.dryRun) {
    buildings.forEach(b => {
      log('DRY', `  ${b.building_id} | ${b.building_name} | permit=${b.sale_permit_id}`);
    });
    log('MAIN', '🔍 dry-run 完成，未执行实际操作');
    process.exit(0);
  }

  try {
    // Phase 1：提取真实 houseId
    await runPhase1(buildings);

    if (options.noBrowser) {
      log('MAIN', '⏭️  跳过 Phase 2（--no-browser）');
    } else {
      // Phase 2：爬取详情
      await runPhase2(buildings);
    }
  } finally {
    await closeBrowser();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('MAIN', `🎉 全部完成，耗时 ${elapsed}s`);

  // 打印最终统计
  const stats = db.query(`
    SELECT
      (SELECT COUNT(*) FROM houses) AS total,
      (SELECT COUNT(*) FROM houses WHERE purpose IS NOT NULL AND layout IS NOT NULL AND build_area IS NOT NULL) AS with_detail,
      (SELECT COUNT(*) FROM houses WHERE real_house_id IS NOT NULL) AS with_real_id
  `)[0];
  log('MAIN', `📊 数据库统计: 总房屋=${stats.total}, 有详情=${stats.with_detail}, 有真实ID=${stats.with_real_id}`);
}

main().catch(err => {
  console.error('❌ 脚本执行失败:', err);
  closeBrowser().then(() => process.exit(1));
});
