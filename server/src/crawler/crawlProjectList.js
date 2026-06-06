/**
 * 北京住建委 — 楼盘列表爬虫（房屋检索接口，按区域爬取）
 * 只用有房屋信息的项目（isTrue=1），天然带区域信息
 */

const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DB_PATH = path.resolve(__dirname, '../../data/bj_realestate.db');

function sqlite3(sql) {
  try {
    return execSync('sqlite3 ' + DB_PATH + ' ' + JSON.stringify(sql), {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch (e) {
    if (e.stderr && e.stderr.includes('no such column')) {
      throw new Error('no such column');
    }
    throw e;
  }
}

const BASE_URL = 'http://bjjs.zjw.beijing.gov.cn';
// 使用房屋检索接口（isTrue=1），天然带区域筛选
const LIST_URL = BASE_URL + '/eportal/ui?pageId=307670';

// 区域映射：ddlQX 值 → 区域名称
const DISTRICT_MAP = {
  2: '东城区',
  3: '西城区',
  6: '朝阳区',
  7: '海淀区',
  8: '丰台区',
  9: '石景山区',
  10: '通州区',
  11: '房山区',
  12: '顺义区',
  13: '门头沟区',
  14: '大兴区',
  15: '怀柔区',
  16: '密云区',
  17: '昌平区',
  18: '延庆区',
  19: '平谷区',
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': LIST_URL,
  'Content-Type': 'application/x-www-form-urlencoded',
};

const PAGE_TIMEOUT = 30000;
const MAX_RETRY = 3;
const WAIT_BETWEEN_PAGES = 5000;
const WAIT_AFTER_REGION = 2000; // 区域切换后等待

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 获取某区域某页的 HTML
 * 使用房屋检索接口（isTrue=1），ddlQX 筛选区域
 */
function fetchPage(ddlQX, pageNum) {
  return new Promise((resolve, reject) => {
    var done = false;
    var timer = setTimeout(() => {
      if (!done) { done = true; reject(new Error('timeout')); }
    }, PAGE_TIMEOUT);

    var body = 'ddlQX=' + ddlQX + '&isTrue=1&currentPage=' + pageNum;
    fetch(LIST_URL, {
      method: 'POST',
      headers: HEADERS,
      body: body,
    }).then(res => {
      if (done) return;
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(text => {
      if (done) return;
      clearTimeout(timer);
      if (!text.includes('projectID')) throw new Error('no projectID');
      done = true;
      resolve(text);
    }).catch(err => {
      if (!done) { done = true; clearTimeout(timer); reject(err); }
    });
  });
}

async function fetchPageWithRetry(ddlQX, pageNum) {
  var lastErr = null;
  for (var attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      return await fetchPage(ddlQX, pageNum);
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRY) {
        var backoff = Math.min(2000 * Math.pow(2, attempt - 1), 15000);
        console.log('    [重试] 第' + attempt + '次: ' + e.message.slice(0, 50) + ', ' + (backoff / 1000) + 's 后重试');
        await sleep(backoff);
      }
    }
  }
  throw new Error('重试' + MAX_RETRY + '次均失败: ' + lastErr.message);
}

function parsePage(html) {
  var $ = cheerio.load(html);
  var projects = [];
  var seen = {};

  // 房屋检索结果表格：项目名称、预售证号、发证时间
  $('a').each(function () {
    var href = $(this).attr('href') || '';
    var text = $(this).text().trim();
    var m = href.match(/projectID[=&]?(\d+)/i);
    if (!m || !text) return;
    var pid = m[1];
    // 跳过预售证号行
    if (/^京房/.test(text)) {
      if (seen[pid]) seen[pid].permit_no = text;
      return;
    }
    if (!seen[pid]) {
      seen[pid] = { project_id: pid, name: text, permit_no: '', issue_date: '', district: '' };
    }
  });

  // 提取发证时间
  $('tr').each(function () {
    var tds = $(this).find('td');
    if (tds.length >= 3) {
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

function getTotalPages(html) {
  var $ = cheerio.load(html);
  var m = $('body').text().match(/总记录数[:\s]*(\d+)/);
  return m ? Math.ceil(parseInt(m[1], 10) / 15) : 1;
}

async function savePageToDb(projects, pageNum, districtName) {
  var today = new Date().toISOString().split('T')[0];
  var inserted = 0, updated = 0, failed = 0;

  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    if (!p.project_id || !p.name) { failed++; continue; }
    try {
      var pid = p.project_id.replace(/'/g, "''");
      var name = p.name.replace(/'/g, "''");
      var pno = (p.permit_no || '').replace(/'/g, "''");
      var idate = (p.issue_date || '').replace(/'/g, "''");
      var dist = (districtName || '').replace(/'/g, "''");

      var check = sqlite3("SELECT id FROM projects WHERE project_id='" + pid + "'");
      if (check) {
        // 更新时同时更新区域（如果新区域非空）
        if (dist) {
          sqlite3("UPDATE projects SET name='" + name + "', permit_no='" + pno + "', issue_date='" + idate + "', district='" + dist + "', updated_at=datetime('now','localtime') WHERE project_id='" + pid + "'");
        } else {
          sqlite3("UPDATE projects SET name='" + name + "', permit_no='" + pno + "', issue_date='" + idate + "', updated_at=datetime('now','localtime') WHERE project_id='" + pid + "'");
        }
        updated++;
      } else {
        sqlite3("INSERT INTO projects (project_id,name,permit_no,issue_date,district,first_seen,status) VALUES ('" + pid + "','" + name + "','" + pno + "','" + idate + "','" + dist + "','" + today + "','active')");
        inserted++;
      }
    } catch (e) {
      console.error('    [DB error] ' + p.project_id + ': ' + e.message.slice(0, 60));
      failed++;
    }
  }

  return { inserted, updated, failed };
}

async function crawlDistrict(ddlQX, districtName) {
  console.log('\n----------------------------------------');
  console.log('  区域: ' + districtName + ' (ddlQX=' + ddlQX + ')');
  console.log('----------------------------------------\n');

  console.log('  [1/3] 爬取第 1 页...');
  var firstHtml;
  try {
    firstHtml = await fetchPageWithRetry(ddlQX, 1);
  } catch (e) {
    console.error('  FAIL 第 1 页失败: ' + e.message);
    return { inserted: 0, updated: 0, failed: 0, pages: 0 };
  }

  var totalPages = getTotalPages(firstHtml);
  var page1Projects = parsePage(firstHtml);

  console.log('    总页数: ' + totalPages + ' | 第 1 页: ' + page1Projects.length + ' 个项目\n');

  console.log('  [2/3] 第 1 页写入数据库...');
  var r1 = await savePageToDb(page1Projects, 1, districtName);
  console.log('    OK 新增' + r1.inserted + ' 更新' + r1.updated + ' 失败' + r1.failed + '\n');

  var totalInserted = r1.inserted;
  var totalUpdated = r1.updated;
  var totalFailed = r1.failed;
  var pageCount = 1;
  var failPages = [];

  console.log('  [3/3] 逐页爬取剩余页面...\n');

  for (var pageNum = 2; pageNum <= totalPages; pageNum++) {
    process.stdout.write('    第 ' + pageNum + '/' + totalPages + ' 页 ... ');

    try {
      var html = await fetchPageWithRetry(ddlQX, pageNum);
      var projects = parsePage(html);
      var r = await savePageToDb(projects, pageNum, districtName);

      totalInserted += r.inserted;
      totalUpdated += r.updated;
      totalFailed += r.failed;
      pageCount++;

      console.log('OK ' + projects.length + ' 个项目 (新增' + r.inserted + ' 更新' + r.updated + ')');
    } catch (e) {
      failPages.push({ page: pageNum, error: e.message });
      console.log('FAIL: ' + e.message.slice(0, 60));

      if (failPages.length >= 3) {
        var last2 = failPages[failPages.length - 2];
        var last3 = failPages[failPages.length - 3];
        if (last2 && last3 && last2.page === pageNum - 1 && last3.page === pageNum - 2) {
          console.log('    WARN 连续 3 页失败，跳过该区域');
          break;
        }
      }
    }

    if (pageNum < totalPages) {
      await sleep(WAIT_BETWEEN_PAGES);
    }
  }

  console.log('\n  DONE ' + districtName + ': ' + pageCount + '/' + totalPages + ' 页, 新增' + totalInserted + ' 更新' + totalUpdated);
  return { inserted: totalInserted, updated: totalUpdated, failed: totalFailed, pages: pageCount };
}

async function main() {
  console.log('========================================');
  console.log('  北京住建委楼盘列表爬虫（房屋检索版）');
  console.log('  时间: ' + new Date().toISOString());
  console.log('  区域数: ' + Object.keys(DISTRICT_MAP).length);
  console.log('  页间等待: ' + (WAIT_BETWEEN_PAGES / 1000) + 's');
  console.log('  超时: ' + (PAGE_TIMEOUT / 1000) + 's / 重试: ' + MAX_RETRY + '次');
  console.log('========================================\n');

  var args = process.argv.slice(2);
  var regionsArg = args.find(a => a.startsWith('--regions='));
  // 默认爬所有区域，可通过 --regions=17,7,6 指定
  var targetRegions = regionsArg
    ? regionsArg.split('=')[1].split(',').map(Number)
    : Object.keys(DISTRICT_MAP).map(Number);

  var totalInserted = 0, totalUpdated = 0, totalFailed = 0, totalPages = 0;
  var allFailPages = [];

  for (var i = 0; i < targetRegions.length; i++) {
    var qx = targetRegions[i];
    var name = DISTRICT_MAP[qx];
    if (!name) {
      console.log('  [跳过] 未知区域 ddlQX=' + qx);
      continue;
    }

    var r = await crawlDistrict(qx, name);
    totalInserted += r.inserted;
    totalUpdated += r.updated;
    totalFailed += r.failed;
    totalPages += r.pages;

    if (i < targetRegions.length - 1) {
      console.log('  等待 ' + (WAIT_AFTER_REGION / 1000) + 's 后切换区域...\n');
      await sleep(WAIT_AFTER_REGION);
    }
  }

  var metaDir = path.resolve(__dirname, '../../data');
  if (!fs.existsSync(metaDir)) fs.mkdirSync(metaDir, { recursive: true });
  fs.writeFileSync(path.join(metaDir, 'project_list_meta.json'), JSON.stringify({
    updated_at: new Date().toISOString(),
    regions: targetRegions.map(qx => DISTRICT_MAP[qx]),
    total_pages: totalPages,
    total_inserted: totalInserted,
    total_updated: totalUpdated,
    total_failed: totalFailed,
  }, null, 2), 'utf-8');

  console.log('\n========================================');
  console.log('  DONE');
  console.log('  区域: ' + targetRegions.length + ' 个');
  console.log('  项目: 新增' + totalInserted + ' 更新' + totalUpdated + ' 失败' + totalFailed);
  console.log('========================================\n');
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL: ' + err.message);
  process.exit(1);
});
