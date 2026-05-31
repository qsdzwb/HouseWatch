/**
 * 北京住建委 — 楼盘列表爬虫（curl 版）
 * 
 * 用法：
 *   node src/crawler/crawlProjectList.js              # 全量，输出 data/projects.json
 *   node src/crawler/crawlProjectList.js --pages=5    # 前5页
 *   node src/crawler/crawlProjectList.js --api         # 全量，通过 API 写入 CVM
 */

const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LIST_URL = 'http://bjjs.zjw.beijing.gov.cn/eportal/ui?pageId=307670';
const CVM_API = 'http://118.25.138.63:3000/api';

const PAGE_DELAY = 2000;   // 页间延迟 ms（避免被封）
const MAX_RETRY = 3;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 用 curl 爬取单页（最可靠）
 */
function fetchPageCurl(pageNum) {
  var args = [
    '-s',
    '-X', 'POST',
    '--max-time', '30',
    '-H', 'Content-Type: application/x-www-form-urlencoded',
    '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    '-H', 'Accept: text/html,application/xhtml+xml',
    '-H', 'Accept-Language: zh-CN,zh;q=0.9',
    '-H', 'Referer: ' + LIST_URL,
    '--retry', '2',
    '--retry-delay', '3',
    '-d', 'currentPage=' + pageNum,
    LIST_URL
  ];

  try {
    var stdout = execFileSync('curl', args, { encoding: 'utf8', timeout: 40000, maxBuffer: 10 * 1024 * 1024 });
    var text = stdout.trim();
    if (!text.includes('projectID')) {
      // 可能是编码问题，再试一次
      throw new Error('返回内容不含项目数据（可能IP被限流）');
    }
    return text;
  } catch (e) {
    throw new Error('第' + pageNum + '页: ' + e.message);
  }
}

/**
 * 带重试的 fetchPageCurl
 */
async function fetchPageWithRetry(pageNum) {
  var lastErr = null;
  for (var attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        try {
          var html = fetchPageCurl(pageNum);
          resolve(html);
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRY) {
        var backoff = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.log('  [重试] 第' + pageNum + '页 第' + attempt + '次: ' + e.message.slice(0, 40) + '，' + (backoff / 1000) + 's后重试...');
        await sleep(backoff);
      }
    }
  }
  throw new Error('第' + pageNum + '页爬取失败（重试' + MAX_RETRY + '次）: ' + lastErr.message);
}

/**
 * 获取总页数
 */
function getTotalPages(html) {
  var $ = cheerio.load(html);
  var m = $('body').text().match(/总记录数[:\s]*(\d+)/);
  return m ? Math.ceil(parseInt(m[1], 10) / 15) : 1;
}

/**
 * 解析单页项目列表
 */
function parsePage(html) {
  var $ = cheerio.load(html);
  var projects = [];
  var seen = {};

  // 第一遍：收集项目名 + 预售证号
  $('a').each(function () {
    var href = $(this).attr('href') || '';
    var text = $(this).text().trim();
    var m = href.match(/projectID[=&]?(\d+)/i);
    if (!m || !text) return;
    var pid = m[1];
    if (/^京房/.test(text)) {
      if (seen[pid]) seen[pid].permit_no = text;
      return;
    }
    if (!seen[pid]) {
      seen[pid] = { project_id: pid, name: text, permit_no: '', issue_date: '' };
    }
  });

  // 第二遍：找发证日期
  $('tr').each(function () {
    var tds = $(this).find('td');
    if (tds.length >= 4) {
      var dateText = $(tds[tds.length - 1]).text().trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(dateText)) {
        $(this).find('a').each(function () {
          var href = $(this).attr('href') || '';
          var m = href.match(/projectID[=&]?(\d+)/i);
          if (m && seen[m[1]]) seen[m[1]].issue_date = dateText;
        });
      }
    }
  });

  for (var id in seen) projects.push(seen[id]);
  return projects;
}

/**
 * 直接写入 CVM 数据库（通过 API）
 */
async function syncToCvm(projects) {
  console.log('\n📤 通过 API 同步到 CVM (' + CVM_API + ')...');
  var inserted = 0, updated = 0, failed = 0;

  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    if (!p.project_id || !p.name) { failed++; continue; }
    try {
      var res = await fetch(CVM_API + '/projects/batch-insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projects: [p] }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        var data = await res.json();
        inserted += (data.data && data.data.inserted) || 0;
        updated += (data.data && data.data.updated) || 0;
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
    }
    if ((i + 1) % 50 === 0) {
      console.log('  进度: ' + (i + 1) + '/' + projects.length + ' (新增:' + inserted + ' 更新:' + updated + ' 失败:' + failed + ')');
    }
  }
  console.log('  完成: 新增' + inserted + ' 更新' + updated + ' 失败' + failed);
  return { inserted, updated, failed };
}

/**
 * main
 */
async function main() {
  var args = process.argv.slice(2);
  var apiMode = args.includes('--api');
  var pagesArg = args.find(a => a.startsWith('--pages='));
  var maxPages = pagesArg ? parseInt(pagesArg.split('=')[1], 10) : null;

  console.log('\n🚀 楼盘列表爬虫启动（curl 版）');
  console.log('   模式: ' + (apiMode ? '通过 API 写 CVM 数据库' : '输出 JSON 文件'));
  console.log('   页间延迟: ' + (PAGE_DELAY / 1000) + 's\n');

  // 1. 先爬第1页，获取总页数
  console.log('📄 爬取第 1 页（获取总页数）...');
  var firstHtml;
  try {
    firstHtml = await fetchPageWithRetry(1);
  } catch (e) {
    console.error('❌ 第1页爬取失败: ' + e.message);
    process.exit(1);
  }

  var totalPages = getTotalPages(firstHtml);
  var firstProjects = parsePage(firstHtml);
  console.log('   总页数: ' + totalPages + '  第1页项目: ' + firstProjects.length + ' 个');

  if (maxPages && maxPages < totalPages) totalPages = maxPages;
  console.log('   本次爬取: ' + totalPages + ' 页\n');

  // 2. 逐页爬取
  var allProjects = firstProjects.slice();
  var errorPages = [];

  console.log('📡 逐页爬取中（每页间隔 ' + (PAGE_DELAY / 1000) + 's）...');
  var startTime = Date.now();

  for (var p = 2; p <= totalPages; p++) {
    try {
      var text = await fetchPageWithRetry(p);
      var projs = parsePage(text);
      allProjects = allProjects.concat(projs);
      process.stdout.write('\r  ✅ 第' + p + '/' + totalPages + '页: ' + projs.length + ' 个项目，累计 ' + allProjects.length + ' 个    ');
    } catch (e) {
      errorPages.push({ page: p, error: e.message });
      process.stdout.write('\r  ❌ 第' + p + '/' + totalPages + '页失败: ' + e.message.slice(0, 40) + '    ');
    }

    if (p < totalPages) await sleep(PAGE_DELAY);
  }
  console.log('\n');

  // 3. 统计
  var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('📊 爬取完成: ' + totalPages + '/' + totalPages + ' 页，' + allProjects.length + ' 个项目，耗时 ' + elapsed + 's');
  if (errorPages.length > 0) {
    console.log('   失败页数: ' + errorPages.length);
    errorPages.forEach(function (e) { console.log('     - 第' + e.page + '页: ' + e.error); });
  }

  // 4. 去重
  var unique = {};
  allProjects.forEach(function (p) {
    if (p.project_id && !unique[p.project_id]) unique[p.project_id] = p;
  });
  var uniqueList = Object.values(unique);
  console.log('   去重后: ' + uniqueList.length + ' 个项目\n');

  // 5. 保存
  if (apiMode) {
    await syncToCvm(uniqueList);
  } else {
    var dataDir = path.resolve(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    var outPath = path.join(dataDir, 'projects.json');
    fs.writeFileSync(outPath, JSON.stringify(uniqueList, null, 2));
    console.log('💾 已保存到 ' + outPath);
  }

  console.log('\n✅ 全部完成\n');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ 异常退出:', err.message);
  process.exit(1);
});
