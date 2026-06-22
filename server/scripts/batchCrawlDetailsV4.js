/**
 * batchCrawlDetailsV4.js — 纯 HTTP 批量爬取房屋详情（不需要 Chrome/Puppeteer）
 * 
 * 关键发现：房屋详情页 URL 必须包含 houseNo 参数才能返回数据
 * URL: pageId=373432&houseId=<ID>&houseNo=<房间号>&categoryId=1&salePermitId=<ID>&systemId=2
 * 
 * 用法:
 *   node scripts/batchCrawlDetailsV4.js [--max-houses N] [--dry-run] [--force] [--concurrency N]
 */

const Database = require('better-sqlite3');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/bj_realestate.db');
const BASE_URL = 'http://bjjs.zjw.beijing.gov.cn/eportal/ui';

// 解析命令行参数
const args = process.argv.slice(2);
let maxHouses = 0;       // 0 = 全部
let dryRun = false;
let forceUpdate = false; // 是否强制更新已有数据的记录
let concurrency = 5;     // 并发数

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--max-houses' && args[i+1]) { maxHouses = parseInt(args[i+1]) || 0; i++; }
  if (args[i] === '--dry-run') { dryRun = true; }
  if (args[i] === '--force') { forceUpdate = true; }
  if (args[i] === '--concurrency' && args[i+1]) { concurrency = parseInt(args[i+1]) || 5; i++; }
}

// ========== 纯 HTTP 请求函数 ==========
function fetchUrl(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;

    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: timeoutMs,
    }, (res) => {
      // 跟随重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf-8');
        resolve({ status: res.statusCode, html, url });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

// ========== 从 HTML 提取房屋详情 ==========
function extractDetailFromHtml(html, houseId) {
  // 去掉 HTML 标签后的文本
  const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                   .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                   .replace(/<[^>]+>/g, '\n')
                   .replace(/&nbsp;/g, ' ')
                   .replace(/\s+/g, ' ')
                   .trim();

  const result = {
    roomNo: '',
    purpose: '',
    layout: '',
    buildArea: '',
    innerArea: '',
    pricePerSqM: '',
    pricePerSqMInner: '',
  };

  // 方法1：正则匹配 "标签   值" 格式
  const patterns = [
    [/房\s*间\s*号\s+(\S[\S^\n]*?)(?=\s*(?:规划|户|建筑|套内|按|$))/, 'roomNo'],
    [/规划\s*设计\s*用\s*途\s+(住宅|商业|办公|车库|其他)/, 'purpose'],
    [/户\s*\u3000*\s*型\s+([^\n]+?)(?=\s*建\s*筑|$)/, 'layout'],
    [/建\s*筑\s*面\s*积\s+([\d.]+)/, 'buildArea'],
    [/套\s*内\s*面\s*积\s+([\d.]+)/, 'innerArea'],
    [/按\s*建\s*筑\s*面\s*积\s*拟\s*售\s*单\s*价\s+([\d.]+)/, 'pricePerSqM'],
    [/按\s*套\s*内\s*面\s*积\s*拟\s*售\s*单\s*价\s+([\d.]+)/, 'pricePerSqMInner'],
  ];

  for (const [pattern, key] of patterns) {
    const match = text.match(pattern);
    if (match) {
      result[key] = match[1].trim();
    }
  }

  return result;
}

// ========== 主逻辑 ==========
async function main() {
  console.log('========================================');
  console.log('  房屋详情批量爬取 V4（纯 HTTP，无 Chrome）');
  console.log('========================================');
  console.log(`参数: maxHouses=${maxHouses || '全部'}, dryRun=${dryRun}, force=${forceUpdate}, concurrency=${concurrency}`);

  // 打开数据库（WAL 模式）
  const db = new Database(DB_PATH, { readonly: false });
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');

  try {
    // 查询需要爬取的房源
    let whereClause = `h.status = '可售' 
      AND h.real_house_id IS NOT NULL AND h.real_house_id != '' 
      AND h.room_no IS NOT NULL AND h.room_no != ''
      AND b.sale_permit_id IS NOT NULL AND b.sale_permit_id != ''`;
    
    if (!forceUpdate) {
      whereClause += ` AND (h.purpose IS NULL OR h.purpose = '')`;
    }

    let limitSql = '';
    if (maxHouses > 0) limitSql = ` LIMIT ${maxHouses}`;

    const rows = db.prepare(`
      SELECT h.house_id, h.real_house_id, h.room_no, b.sale_permit_id
      FROM houses h
      JOIN buildings b ON h.building_id = b.building_id
      WHERE ${whereClause}
      ORDER BY h.house_id
      ${limitSql}
    `).all();

    console.log(`\n待爬取房源数量: ${rows.length}`);
    
    if (rows.length === 0) {
      console.log('没有需要爬取的房源');
      db.close();
      return;
    }

    if (dryRun) {
      console.log('\n[DRY RUN] 前 10 条预览:');
      for (const r of rows.slice(0, 10)) {
        const houseNoEncoded = encodeURIComponent(r.room_no);
        const url = `${BASE_URL}?pageId=373432&houseId=${r.real_house_id}&houseNo=${houseNoEncoded}&categoryId=1&salePermitId=${r.sale_permit_id}&systemId=2`;
        console.log(`  ${r.house_id} | ${r.room_no} | houseId=${r.real_house_id} | salePermitId=${r.sale_permit_id}`);
      }
      db.close();
      return;
    }

    // 准备 UPDATE 语句
    const updateStmt = db.prepare(`
      UPDATE houses SET 
        purpose = ?, layout = ?, build_area = ?, inner_area = ?,
        list_price_per_sqm = ?, updated_at = datetime('now', 'localtime')
      WHERE house_id = ?
    `);

    // 批量更新（使用事务）
    const stats = { total: rows.length, success: 0, noData: 0, error: 0 };
    const startTime = Date.now();
    let completed = 0;

    // 并发控制
    async function processBatch(items) {
      return Promise.all(items.map(async (row) => {
        const houseNoEncoded = encodeURIComponent(row.room_no);
        const url = `${BASE_URL}?pageId=373432&houseId=${row.real_house_id}&houseNo=${houseNoEncoded}&categoryId=1&salePermitId=${row.sale_permit_id}&systemId=2`;

        try {
          const { html } = await fetchUrl(url);

          // 检查是否有有效数据（页面大小太小说明是空页）
          if (html.length < 2000) {
            stats.noData++;
            completed++;
            if (completed % 500 === 0 || completed === rows.length) {
              printProgress(completed, rows.length, startTime, stats);
            }
            return;
          }

          const detail = extractDetailFromHtml(html, row.real_house_id);
          const hasData = detail.purpose || detail.layout || detail.buildArea;

          if (hasData) {
            // 写入数据库
            updateStmt.run(
              detail.purpose || null,
              detail.layout || null,
              detail.buildArea ? parseFloat(detail.buildArea) : null,
              detail.innerArea ? parseFloat(detail.innerArea) : null,
              detail.pricePerSqM ? parseFloat(detail.pricePerSqM) : null,
              row.house_id
            );
            stats.success++;
            
            if (stats.success <= 5 || stats.success % 200 === 0) {
              console.log(`  ✅ [${stats.success}] ${row.room_no}: 用途=${detail.purpose}, 户型=${detail.layout}, 面积=${detail.buildArea}m², 单价=${detail.pricePerSqM}`);
            }
          } else {
            stats.noData++;
          }
        } catch (err) {
          stats.error++;
          if (stats.error <= 10) {
            console.log(`  ❌ [${row.house_id}] ${row.room_no}: ${err.message.substring(0, 80)}`);
          }
        }

        completed++;
        if (completed % 500 === 0 || completed === rows.length) {
          printProgress(completed, rows.length, startTime, stats);
        }
      }));
    }

    // 分批执行
    console.log(`\n开始爬取... (并发: ${concurrency})`);
    for (let i = 0; i < rows.length; i += concurrency) {
      const batch = rows.slice(i, i + concurrency);
      await processBatch(batch);
      
      // 每批之间稍作延迟，避免被限速
      if (i + concurrency < rows.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // 最终报告
    printProgress(rows.length, rows.length, startTime, stats);
    console.log('\n========================================');
    console.log(`完成! 成功: ${stats.success}, 无数据: ${stats.noData}, 失败: ${stats.error}`);
    console.log(`总耗时: ${((Date.now() - startTime) / 1000).toFixed(1)} 秒`);

  } finally {
    db.close();
  }
}

function printProgress(completed, total, startTime, stats) {
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = elapsed > 0 ? (completed / elapsed).toFixed(1) : '0';
  const pct = ((completed / total) * 100).toFixed(1);
  process.stdout.write(`\r进度: ${completed}/${total} (${pct}%) | ✅${stats.success} ⬜${stats.noData} ❌${stats.error} | ${rate}/s     `);
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(1);
});
