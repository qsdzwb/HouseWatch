/**
 * 快速通道 — 只爬项目汇总数据
 *
 * 请求 pageId=320794（项目详情页），提取底部汇总表格的签约数据，
 * 写入 project_daily_stats。不遍历楼栋，极快。
 *
 * 230 项目 × 3s 延迟 ≈ 12 分钟。每 6 小时跑一次即可保证 project_daily_stats 完整。
 *
 * 用法（在 CVM /user/local/service/house 目录下）：
 *   node scripts/crawlProjectSummary.js
 *   node scripts/crawlProjectSummary.js --delay 2000     # 自定义延迟
 *   node scripts/crawlProjectSummary.js --dry-run        # 预览
 */

const path = require('path');
const fs = require('fs');
const http = require('http');

// ── 加载 .env ────────────────────────────────────────
function loadEnv() {
  const envPaths = [
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../.env'),
  ];
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      const c = fs.readFileSync(p, 'utf8');
      for (const line of c.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i === -1) continue;
        const k = t.substring(0, i).trim();
        let v = t.substring(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[k]) process.env[k] = v;
      }
      console.log(`[env] ${p}`);
      return;
    }
  }
  console.log('[env] 未找到 .env');
}
loadEnv();

// ── 参数 ─────────────────────────────────────────────
const args = process.argv;
const opts = { delay: 3000, dryRun: false };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') opts.dryRun = true;
  else if (args[i] === '--delay' && args[i + 1]) opts.delay = parseInt(args[++i], 10);
}

// ── 数据库 ───────────────────────────────────────────
const Database = require('better-sqlite3');
const dbPath = process.env.DB_SQLITE_PATH
  ? path.resolve(__dirname, '..', process.env.DB_SQLITE_PATH)
  : path.join(__dirname, '../data/bj_realestate.db');
console.log(`[db] ${dbPath}`);
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// ── HTTP 请求 ────────────────────────────────────────
function fetchHtml(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const doFetch = (attempt) => {
      const u = new URL(url);
      const req = http.request({
        hostname: u.hostname, port: u.port || 80,
        path: u.pathname + u.search, method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        timeout: 30000,
      }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return fetchHtml(res.headers.location, 0).then(resolve).catch(reject);
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', c => { body += c; });
        res.on('end', () => {
          if (body.length < 10000 && attempt < retries) {
            setTimeout(() => doFetch(attempt + 1), 5000);
          } else {
            resolve(body);
          }
        });
      });
      req.on('error', err => attempt < retries ? setTimeout(() => doFetch(attempt + 1), 2000) : reject(err));
      req.on('timeout', () => { req.destroy(); attempt < retries ? setTimeout(() => doFetch(attempt + 1), 2000) : reject(new Error('timeout')); });
      req.end();
    };
    doFetch(0);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── 解析汇总表格 ─────────────────────────────────────
function extractSummary(html, projectId) {
  const idx = html.indexOf('已签约套数');
  if (idx < 0) return null;

  const tableStart = html.lastIndexOf('<table', idx);
  const tableEnd = html.indexOf('</table>', idx);
  if (tableStart < 0 || tableEnd < 0) return null;

  const table = html.substring(tableStart, tableEnd + 8);
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  let skipHeader = true;

  while ((match = rowRegex.exec(table)) !== null) {
    const row = match[1];
    if (!row) continue;
    const tds = [];
    const tdRegex = /<td[^>]*>\s*([\s\S]*?)\s*<\/td>/gi;
    let tm;
    while ((tm = tdRegex.exec(row)) !== null) {
      let c = tm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (c) tds.push(c);
    }

    if (tds.length < 4) continue;

    const purpose = tds[0];
    if (!purpose.includes('住宅')) continue;

    try {
      const signedCount = parseInt(tds[1], 10);
      const signedArea = parseFloat(tds[2]);
      const avgPrice = parseFloat(tds[3]);
      if (isNaN(signedCount) || isNaN(signedArea) || isNaN(avgPrice)) continue;
      return { signed_count: signedCount, signed_area: signedArea, avg_price: avgPrice };
    } catch (e) { /* skip */ }
  }

  return null;
}

// ── 主流程 ───────────────────────────────────────────
async function main() {
  const pageUrl = process.env.CRAWL_PAGE_URL || 'http://bjjs.zjw.beijing.gov.cn/eportal/ui';

  const projects = db.prepare(
    "SELECT project_id, name FROM projects WHERE status = 'active' ORDER BY district, name"
  ).all();

  console.log(`\n🏠 快速通道 — 项目汇总数据更新`);
  console.log(`   项目数: ${projects.length}`);
  console.log(`   延迟: ${opts.delay}ms/项`);
  console.log(`   预计耗时: ~${Math.round(projects.length * opts.delay / 1000 / 60)} 分钟`);
  if (opts.dryRun) console.log(`   ⚠️  DRY-RUN 模式\n`);

  const today = new Date().toISOString().split('T')[0];
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO project_daily_stats (project_id, stat_date, signed_count, signed_area, avg_price)
    VALUES (?, ?, ?, ?, ?)
  `);

  let ok = 0, empty = 0, fail = 0;
  const start = Date.now();

  for (let i = 0; i < projects.length; i++) {
    const proj = projects[i];
    const url = `${pageUrl}?pageId=320794&projectID=${proj.project_id}&systemID=2&srcId=1`;

    try {
      if (opts.dryRun) {
        console.log(`  [${i + 1}/${projects.length}] DRY-RUN ${proj.project_id} ${proj.name}`);
        continue;
      }

      const html = await fetchHtml(url, 3);

      if (!html || html.length < 10000) {
        console.log(`  [${i + 1}/${projects.length}] ❌ ${proj.name} — 空响应(${html ? html.length : 0}B)`);
        fail++;
        continue;
      }

      const summary = extractSummary(html, proj.project_id);

      if (!summary) {
        console.log(`  [${i + 1}/${projects.length}] ⚠️  ${proj.name} — 无住宅数据`);
        empty++;
        continue;
      }

      insertStmt.run(proj.project_id, today, summary.signed_count, summary.signed_area, summary.avg_price);

      console.log(`  [${i + 1}/${projects.length}] ✅ ${proj.name} | 已签${summary.signed_count}套 | 均价¥${Math.round(summary.avg_price).toLocaleString()}/㎡`);
      ok++;
    } catch (err) {
      console.log(`  [${i + 1}/${projects.length}] ❌ ${proj.name} — ${err.message}`);
      fail++;
    }

    // 进度报告
    if ((i + 1) % 50 === 0) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      const eta = Math.round(elapsed / (i + 1) * (projects.length - i - 1));
      console.log(`  📊 进度 ${i + 1}/${projects.length} | 成功 ${ok} | 空 ${empty} | 失败 ${fail} | 已耗时 ${Math.floor(elapsed/60)}m | 预计剩余 ${Math.floor(eta/60)}m`);
    }

    // 请求延迟
    if (i < projects.length - 1) {
      await sleep(opts.delay);
    }
  }

  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`\n===== 完成 =====`);
  console.log(`   成功: ${ok} | 无数据: ${empty} | 失败: ${fail} | 总耗时: ${Math.floor(elapsed/60)}m${elapsed%60}s`);
  console.log(`   日期: ${today}\n`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
