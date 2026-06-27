/**
 * 批量预爬房屋详情 — 纯 HTTP 版本
 *
 * 房屋详情页 (pageId=373432) 不需要 Chrome/Puppeteer，
 * 纯 HTTP 即可获取完整数据（面积、户型、用途等）。
 * 本脚本将所有缺数据的房屋提前爬一遍，写入 DB。
 *
 * 用法：
 *   node scripts/batchCrawlDetails.js --dry-run          预览
 *   node scripts/batchCrawlDetails.js --max 50           只爬50套
 *   node scripts/batchCrawlDetails.js --max 0 --delay 5000  全量爬，5秒延迟
 */
const path = require('path');
const fs = require('fs');
const http = require('http');

// 加载 .env
(function loadEnv() {
  const paths = ['../.env', '../../.env', 'src/.env'].map(p => path.resolve(__dirname, p));
  for (const p of paths) {
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const m = line.trim().match(/^([^#=]+)=(.*)/);
        if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
      }
      console.log('[env]', p);
      return;
    }
  }
})();

// 参数
const args = {};
for (let i = 0; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--dry-run') args.dryRun = true;
  else if (a === '--force') args.force = true;
  else if (a === '--max' && process.argv[i + 1]) args.max = parseInt(process.argv[++i], 10);
  else if (a === '--delay' && process.argv[i + 1]) args.delay = parseInt(process.argv[++i], 10);
}
args.max = args.max ?? 200;
args.delay = args.delay ?? 3000;

// 数据库
const Database = require('better-sqlite3');
const dbPath = path.resolve(__dirname, '..', process.env.DB_SQLITE_PATH || './data/bj_realestate.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const pageUrl = process.env.CRAWL_PAGE_URL || 'http://bjjs.zjw.beijing.gov.cn/eportal/ui';

// 去除全角空格等空白
function strip(s) {
  return s.replace(/[\s\u3000\u00A0]+/g, '');
}

// 从 HTML 提取房屋资料
function extract(html) {
  const r = {};
  const re = /<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const label = strip(m[1].replace(/<[^>]+>/g, '').trim());
    const val = m[2].replace(/<[^>]+>/g, '').trim();
    if (!val) continue;
    if (label.includes('建筑面积') && !label.includes('套内') && !label.includes('拟售')) r.buildArea = val;
    else if (label.includes('套内面积') && !label.includes('拟售')) r.innerArea = val;
    else if (label.includes('用途') && !label.includes('房间') && !label.includes('面积')) r.purpose = r.purpose || val;
    else if (label.includes('户型')) r.layout = val;
    else if (label.includes('建筑面积拟售单价')) r.pricePerSqM = val;
  }
  return r;
}

// 纯 HTTP 请求
function fetchHtml(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const go = (n) => {
      const u = new URL(url);
      const req = http.request({
        hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        timeout: 30000,
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchHtml(res.headers.location, 0).then(resolve).catch(reject);
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', c => { body += c; });
        res.on('end', () => {
          if (body.length < 1000 && n < retries) setTimeout(() => go(n + 1), 2000);
          else resolve(body);
        });
      });
      req.on('error', (e) => n < retries ? setTimeout(() => go(n + 1), 2000) : reject(e));
      req.on('timeout', () => { req.destroy(); n < retries ? setTimeout(() => go(n + 1), 2000) : reject(new Error('timeout')); });
      req.end();
    };
    go(0);
  });
}

function parseNum(s) {
  if (!s) return null;
  const m = String(s).match(/(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  // 查询待爬取房屋：有真实数字 ID 且缺数据
  const query = args.force
    ? `SELECT h.house_id, h.room_no, h.building_id, b.sale_permit_id
       FROM houses h JOIN buildings b ON h.building_id = b.building_id
       WHERE h.house_id NOT GLOB '*_*' ORDER BY h.id`
    : `SELECT h.house_id, h.room_no, h.building_id, b.sale_permit_id
       FROM houses h JOIN buildings b ON h.building_id = b.building_id
       WHERE h.house_id NOT GLOB '*_*'
         AND (h.build_area IS NULL OR h.purpose IS NULL) ORDER BY h.id`;

  const all = db.prepare(query).all();
  const count = args.max === 0 ? all.length : Math.min(args.max, all.length);
  const houses = all.slice(0, count);

  console.log(`\n🏠 批量爬取房屋详情`);
  console.log(`   共 ${all.length} 套缺数据，本次处理 ${houses.length} 套`);
  console.log(`   延迟 ${args.delay}ms/套${args.dryRun ? ' ⚠️ DRY-RUN' : ''}\n`);

  let ok = 0, fail = 0, skip = 0;
  const updateStmt = db.prepare(
    `UPDATE houses SET purpose=?, layout=?, build_area=?, inner_area=?,
     list_price_per_sqm=?, list_total_price=?,
     updated_at=datetime('now','localtime')
     WHERE house_id=?`
  );
  const now = Date.now();

  for (let i = 0; i < houses.length; i++) {
    const h = houses[i];
    const pct = ((i + 1) / houses.length * 100).toFixed(1);
    process.stdout.write(`\r[${i + 1}/${houses.length} ${pct}%] ${h.house_id} (${h.room_no}) `);

    try {
      const url = `${pageUrl}?pageId=373432&houseId=${h.house_id}&categoryId=1&salePermitId=${h.sale_permit_id}&systemId=2`;
      const html = await fetchHtml(url, 3);

      if (html.indexOf('房屋资料') < 0) {
        skip++;
        process.stdout.write(`→ 无房屋资料区块`);
        continue;
      }

      const d = extract(html);
      if (!d.buildArea && !d.purpose) {
        skip++;
        process.stdout.write(`→ 未提取到数据`);
        continue;
      }

      const buildArea = parseNum(d.buildArea);
      const innerArea = parseNum(d.innerArea);
      const pricePerSqm = parseNum(d.pricePerSqM);
      const totalPrice = buildArea && pricePerSqm ? (buildArea * pricePerSqm) : null;

      if (!args.dryRun) {
        updateStmt.run(d.purpose || null, d.layout || null, buildArea, innerArea, pricePerSqm, totalPrice, h.house_id);
      }

      ok++;
      process.stdout.write(`→ ✓ ${(d.buildArea || '').trim()}`);
    } catch (e) {
      fail++;
      process.stdout.write(`→ ✗ ${e.message}`);
    }

    if (i < houses.length - 1) await sleep(args.delay);
  }

  const elapsed = ((Date.now() - now) / 1000).toFixed(0);
  console.log(`\n\n✅ 完成! 成功 ${ok} / 失败 ${fail} / 跳过 ${skip}，耗时 ${elapsed}s`);
  db.close();
}

main().catch(e => { console.error(e); db.close(); process.exit(1); });
