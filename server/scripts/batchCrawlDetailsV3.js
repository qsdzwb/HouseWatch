/**
 * 批量预爬房屋详情脚本 v3
 *
 * 背景：小程序用户点击房屋时，后端会实时爬取住建委房屋详情页（用途/户型/面积等）
 *        本脚本在后台预先跑一遍，把所有「可售」房屋的详情数据提前写入 DB，
 *        用户点击时直接读库，无需等待爬取。
 *
 * ⚠️ 重要发现：只有「可售」状态的房源才能查看房屋详细信息，
 *             非可售状态（已签约/网上联机备案等）住建委不提供详情页。
 *
 * 两阶段：
 *   Phase 1 — 从楼栋楼盘表页提取真实 houseId（real_house_id 映射）
 *            注意：只有「可售」状态的房源才有详情链接，Phase 1 只能提取到可售房源的 real_house_id
 *   Phase 2 — 对缺少详情数据的「可售」房屋，逐个爬取住建委房屋详情页
 *
 * 安全机制：
 *   - 默认只处理「可售」状态（--all-status 可跳过此限制）
 *   - --max-houses N：限制本次运行最多爬 N 套（默认 100，可分批多次运行）
 *   - 每套之间延迟 3 秒，避免被限速
 *   - 浏览器单例复用，不会泄漏
 *
 * 用法（在服务器上，/user/local/service/house 目录下运行）：
 *   node scripts/batchCrawlDetailsV3.js --dry-run           # 预览
 *   node scripts/batchCrawlDetailsV3.js --max-houses 50    # 只爬 50 套（测试）
 *   node scripts/batchCrawlDetailsV3.js                      # 默认跑 100 套
 *   node scripts/batchCrawlDetailsV3.js --max-houses 0      # 不限制（跑全部）
 *   node scripts/batchCrawlDetailsV3.js --all               # 跑所有楼盘（仍受 max-houses 限制）
 *   node scripts/batchCrawlDetailsV3.js --force             # 强制重爬已有数据
 *   node scripts/batchCrawlDetailsV3.js --no-phase2         # 只跑 Phase 1
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
  maxHouses: 100,       // 默认最多爬 100 套，可分批多次运行
  dryRun: false,
  force: false,
  noPhase2: false,
  onlyAvailable: true,
};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--all') options.all = true;
  else if (a === '--dry-run' || a === '--dryRun') options.dryRun = true;
  else if (a === '--force') options.force = true;
  else if (a === '--no-phase2') options.noPhase2 = true;
  else if (a === '--all-status') options.onlyAvailable = false;
  else if (a === '--max-houses' && args[i + 1]) { options.maxHouses = parseInt(args[++i], 10); }
}

// ── 依赖（延迟加载）──────────────────────────────────
let db = null;
let browser = null;

function getDb() {
  if (!db) {
    const Database = require('better-sqlite3');
    const dbPath = process.env.DB_SQLITE_PATH
      ? path.resolve(__dirname, '..', process.env.DB_SQLITE_PATH)
      : path.join(__dirname, '../data/bj_realestate.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

async function getBrowser() {
  // 正确检查浏览器是否已连接（puppeteer API: browser.isConnected() 是函数）
  if (browser && typeof browser.isConnected === 'function' && browser.isConnected()) {
    return browser;
  }
  // 也兼容旧版 puppeteer 的 browser.connected 属性
  if (browser && browser.connected) {
    return browser;
  }
  // 启动新浏览器
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
  if (browser) {
    try {
      // 兼容 isConnected() 函数 和 connected 属性
      const isUp = typeof browser.isConnected === 'function'
        ? browser.isConnected()
        : (browser.connected === true);
      if (isUp) {
        await browser.close();
        console.log('[BR] Chrome 已关闭');
      }
    } catch (e) {
      console.error('[BR] 关闭浏览器时出错:', e.message);
    } finally {
      browser = null;
    }
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

    const realIdMap = await crawlBuildingPage(bld.building_id, bld.sale_permit_id);
    if (Object.keys(realIdMap).length === 0) {
      log('P1', `  ⚠️  未提取到任何真实 houseId（该楼栋可能无可售房源）`);
      continue;
    }

    const matched = syncRealIds(realIdMap, bld.building_id);
    totalMatched += matched;

    await sleep(2000);
  }

  log('P1', `✅ Phase 1 完成：共匹配 ${totalMatched} 个真实 houseId`);
  return totalMatched;
}

async function crawlBuildingPage(buildingId, salePermitId) {
  const baseUrl = (process.env.CRAWL_PAGE_URL || 'http://bjjs.zjw.beijing.gov.cn/eportal/ui').replace(/\/$/, '');
  const url = `${baseUrl}?pageId=320833&systemId=2&categoryId=1&salePermitId=${salePermitId}&buildingId=${buildingId}`;

  let page;
  try {
    page = await newPage();
    log('P1', `  📋 访问楼盘表页`);

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

      // 方法2：找含 houseId 的 onclick 属性
      document.querySelectorAll('[onclick]').forEach(el => {
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

function syncRealIds(realIdMap, buildingId) {
  const db = getDb();
  const houses = db.prepare(
    'SELECT house_id, room_no, real_house_id FROM houses WHERE building_id = ?'
  ).all(buildingId);

  let matched = 0;
  const update = db.prepare(
    'UPDATE houses SET real_house_id = ?, updated_at = datetime(\'now\',\'localtime\') WHERE house_id = ?'
  );

  for (const h of houses) {
    if (h.real_house_id && !options.force) continue;

    let realHouseId = null;

    // 策略1：精确匹配 room_no
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
      // 策略3：去掉非数字前缀
      if (!realHouseId) {
        const cleanRoom = h.room_no.replace(/^\D+/, '');
        for (const [pageRoom, rid] of Object.entries(realIdMap)) {
          if (cleanRoom === pageRoom.replace(/^\D+/, '')) { realHouseId = rid; break; }
        }
      }
    }

    if (realHouseId) {
      update.run(realHouseId, h.house_id);
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

  const { crawlHouseDetail } = require('../src/crawler/crawlHouseDetail');

  let totalToCrawl = 0;
  let updated = 0;
  let failed = 0;
  let noData = 0;
  let skipped = 0;

  for (const [idx, bld] of buildings.entries()) {
    log('P2', `[${idx + 1}/${buildings.length}] ${bld.building_name} (${bld.building_id})`);

    // 只查「可售」状态（非可售状态无法查看详情）
    let sql, params;
    const statusCond = options.onlyAvailable ? " AND status = '可售'" : '';
    if (options.force) {
      sql = `
        SELECT house_id, real_house_id, room_no, status
        FROM houses
        WHERE building_id = ? AND real_house_id IS NOT NULL${statusCond}
      `;
      params = [bld.building_id];
    } else {
      sql = `
        SELECT house_id, real_house_id, room_no, status
        FROM houses
        WHERE building_id = ? AND real_house_id IS NOT NULL
          AND (purpose IS NULL OR layout IS NULL OR build_area IS NULL)${statusCond}
      `;
      params = [bld.building_id];
    }

    const housesToCrawl = getDb().prepare(sql).all(...params);

    if (housesToCrawl.length === 0) {
      if (options.onlyAvailable) {
        const available = getDb().prepare(
          "SELECT COUNT(*) as c FROM houses WHERE building_id = ? AND status = '可售'"
        ).get(bld.building_id).c;
        if (available === 0) {
          log('P2', `  ⏭️  跳过（该楼栋无可售房屋）`);
        } else {
          log('P2', `  ⏭️  无需爬取（可售房屋已有完整数据）`);
        }
      } else {
        log('P2', `  ⏭️  无需爬取`);
      }
      continue;
    }

    log('P2', `  📊 待爬取: ${housesToCrawl.length} 套`);
    totalToCrawl += housesToCrawl.length;

    for (const [hIdx, house] of housesToCrawl.entries()) {
      // 检查是否达到上限
      if (options.maxHouses > 0 && updated + failed + noData >= options.maxHouses) {
        log('P2', `  ⚠️  已达到 --max-houses ${options.maxHouses} 上限，停止`);
        skipped = options.maxHouses - (updated + failed + noData);
        break;
      }

      log('P2', `    [${hIdx + 1}/${housesToCrawl.length}] ${house.room_no}`);

      if (options.dryRun) {
        log('P2', `    🔍 [dry-run] 将爬取 houseId=${house.real_house_id}`);
        continue;
      }

      try {
        const detail = await crawlHouseDetail(house.real_house_id, bld.sale_permit_id);

        if (detail && (detail.purpose || detail.layout || detail.buildArea)) {
          const buildAreaMatch = String(detail.buildArea || '').match(/([\d.]+)/);
          const innerAreaMatch = String(detail.innerArea || '').match(/([\d.]+)/);
          const priceMatch = String(detail.pricePerSqM || '').match(/([\d.]+)/);

          getDb().prepare(`
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
            priceMatch ? parseFloat(priceMatch[1]) : null,
            house.house_id
          );
          updated++;
          log('P2', `    ✅ ${detail.purpose || ''} ${detail.layout || ''} 建面=${detail.buildArea || '-'}`);
        } else {
          noData++;
          log('P2', `    ⚠️  未获取到详情（可能该房已状态变更）`);
        }
      } catch (err) {
        failed++;
        log('P2', `    ❌ 失败: ${err.message}`);
      }

      // 每套之间延迟 3 秒
      await sleep(3000);
    }

    if (skipped > 0) break;
    await sleep(3000);
  }

  log('P2', `✅ Phase 2 完成：待爬=${totalToCrawl}, 成功=${updated}, 失败=${failed}, 无数据=${noData}`);
}

// ═══════════════════════════════════════════════════════
//  主流程
// ═══════════════════════════════════════════════════════
async function main() {
  const startTime = Date.now();

  log('MAIN', '🚀 批量预爬房屋详情 v3 启动');
  log('MAIN', `模式: ${options.all ? '全部楼盘' : '关注楼盘'} | dryRun=${options.dryRun} | maxHouses=${options.maxHouses} | onlyAvailable=${options.onlyAvailable}`);

  const db = getDb();

  // 确保 real_house_id 列存在
  const cols = db.prepare('PRAGMA table_info(houses)').all();
  if (!cols.some(c => c.name === 'real_house_id')) {
    log('MAIN', '🔧 自动迁移：添加 real_house_id 列');
    db.exec('ALTER TABLE houses ADD COLUMN real_house_id TEXT');
  }

  // 查询楼栋
  let buildings;
  if (options.all) {
    buildings = db.prepare(
      'SELECT building_id, building_name, sale_permit_id, project_id FROM buildings'
    ).all();
  } else {
    buildings = db.prepare(`
      SELECT b.building_id, b.building_name, b.sale_permit_id, b.project_id
      FROM buildings b
      JOIN watched_projects wp ON b.project_id = wp.project_id
      WHERE wp.is_active = 1
    `).all();
  }

  if (buildings.length === 0) {
    log('MAIN', '⚠️  没有找到楼栋，退出');
    process.exit(0);
  }

  log('MAIN', `📋 共 ${buildings.length} 个楼栋待处理`);

  if (options.dryRun) {
    buildings.forEach(b => {
      log('DRY', `  ${b.building_id} | ${b.building_name} | permit=${b.sale_permit_id}`);
    });
    log('MAIN', '🔍 dry-run 完成');
    process.exit(0);
  }

  try {
    await runPhase1(buildings);

    if (options.noPhase2) {
      log('MAIN', '⏭️  跳过 Phase 2（--no-phase2）');
    } else {
      await runPhase2(buildings);
    }
  } finally {
    await closeBrowser();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('MAIN', `🎉 全部完成，耗时 ${elapsed}s`);

  // 最终统计
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM houses) AS total,
      (SELECT COUNT(*) FROM houses WHERE purpose IS NOT NULL AND layout IS NOT NULL AND build_area IS NOT NULL) AS with_detail,
      (SELECT COUNT(*) FROM houses WHERE real_house_id IS NOT NULL) AS with_real_id
  `).get();
  log('MAIN', `📊 统计: 总=${stats.total}, 有详情=${stats.with_detail}, 有realId=${stats.with_real_id}`);
}

main().catch(async err => {
  console.error('❌ 脚本执行失败:', err);
  await closeBrowser();
  process.exit(1);
});
