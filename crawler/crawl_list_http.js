/**
 * 北京住建委 — 楼盘列表全量爬虫（纯HTTP版，无需Chrome）
 *
 * 翻页机制：POST /eportal/ui?pageId=307670，参数 currentPage=N
 * 数据在服务端渲染的HTML中，不需要JS执行
 *
 * 用法：
 *   node crawler/crawl_list_http.js              # 全量爬取（约602页）
 *   node crawler/crawl_list_http.js --pages=5     # 只爬前N页
 *   node crawler/crawl_list_http.js --out=test.json  # 指定输出文件
 */

const fs = require('fs');
const path = require('path');

// cheerio 安装位置
const CHEERIO_PATH = path.join(require('os').homedir(), '.workbuddy/binaries/node/workspace/node_modules/cheerio');
const cheerio = require(CHEERIO_PATH);

const OUTPUT_DIR = path.join(__dirname, 'output');
const LIST_FILE = path.join(OUTPUT_DIR, 'project_list.json');

const BASE_URL = 'http://bjjs.zjw.beijing.gov.cn';
const LIST_URL = BASE_URL + '/eportal/ui?pageId=307670';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': LIST_URL,
};

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

async function fetchPage(pageNum) {
  var body = 'currentPage=' + pageNum;
  var res = await fetch(LIST_URL, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, HEADERS),
    body: body,
  });

  if (!res.ok) throw new Error('HTTP ' + res.status + ' for page ' + pageNum);
  return await res.text();
}

function parsePage(html) {
  var $ = cheerio.load(html);
  var projects = [];

  // 数据表格：class 含 list_feny，表格头为 "项目名称 | 预售证号 | 发证时间"
  $('table').each(function() {
    var rows = $(this).find('tr');
    if (rows.length < 2) return;

    // 检查表头
    var firstRow = $(rows[0]);
    if (!firstRow.text().includes('项目名称')) return;

    rows.each(function() {
      var cells = $(this).find('td');
      if (cells.length < 3) return;

      var nameCell = $(cells[0]);
      var link = nameCell.find('a[href*="projectID"]');
      if (!link.length) return;

      var href = link.attr('href') || '';
      var pidMatch = href.match(/projectID=(\d+)/);
      if (!pidMatch) return;

      projects.push({
        project_id: pidMatch[1],
        name: link.text().trim(),
        permit_no: $(cells[1]).text().trim(),
        issue_date: $(cells[2]).text().trim(),
        district: '',
        developer: '',
        address: '',
      });
    });
  });

  // 如果按表格没找到，尝试直接搜索所有 projectID 链接
  if (projects.length === 0) {
    $('a[href*="projectID"]').each(function() {
      var href = $(this).attr('href') || '';
      var pidMatch = href.match(/projectID=(\d+)/);
      var name = $(this).text().trim();
      if (pidMatch && name && name.length > 1 && name.length < 100) {
        var row = $(this).closest('tr');
        var cells = row.find('td');
        projects.push({
          project_id: pidMatch[1],
          name: name,
          permit_no: cells.length >= 2 ? $(cells[1]).text().trim() : '',
          issue_date: cells.length >= 3 ? $(cells[2]).text().trim() : '',
          district: '',
          developer: '',
          address: '',
        });
      }
    });
  }

  return projects;
}

function getTotalPages(html) {
  var m = html.match(/总记录数:(\d+),/);
  if (!m) return 1;
  var total = parseInt(m[1], 10);
  return Math.ceil(total / 15);
}

async function main() {
  var args = process.argv.slice(2);
  var maxPages = parseInt((args.find(function(a) { return a.startsWith('--pages='); }) || '--pages=9999').split('=')[1], 10);
  var outFile = (args.find(function(a) { return a.startsWith('--out='); }) || '--out=' + LIST_FILE).split('=')[1];

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('=== 北京住建委楼盘列表爬虫（纯HTTP） ===\n');
  console.log('目标URL: ' + LIST_URL);
  console.log('最大页数: ' + (maxPages < 9999 ? maxPages : '全量') + '\n');

  // 第1步：获取第1页，同时探测总页数
  console.log('[第1步] 获取第1页，探测总页数...');
  var html = await fetchPage(1);
  var totalPages = getTotalPages(html);
  var pagesToFetch = Math.min(totalPages, maxPages);
  console.log('  总记录数: ' + (totalPages * 15) + ', 总页数: ' + totalPages + ', 将爬取: ' + pagesToFetch + ' 页\n');

  // 解析第1页
  var page1Projects = parsePage(html);
  console.log('  第1页: ' + page1Projects.length + ' 个项目');

  var allProjects = page1Projects;
  var seen = new Set();
  page1Projects.forEach(function(p) { seen.add(p.project_id); });

  // 第2步：爬取剩余页
  console.log('\n[第2步] 爬取第2~' + pagesToFetch + '页...');
  for (var pageNum = 2; pageNum <= pagesToFetch; pageNum++) {
    try {
      var pageHtml = await fetchPage(pageNum);
      var pageProjects = parsePage(pageHtml);

      // 去重
      var newCount = 0;
      pageProjects.forEach(function(p) {
        if (!seen.has(p.project_id)) {
          seen.add(p.project_id);
          allProjects.push(p);
          newCount++;
        }
      });

      console.log('  第' + pageNum + '/' + pagesToFetch + '页: ' + pageProjects.length + ' 个 (新增' + newCount + '个)');

      // 每50页保存一次
      if (pageNum % 50 === 0) {
        fs.writeFileSync(outFile, JSON.stringify(allProjects, null, 2), 'utf-8');
        console.log('  💾 已保存 ' + allProjects.length + ' 个项目');
      }

      // 请求间隔，避免被反爬
      await sleep(500);
    } catch (e) {
      console.log('  ❌ 第' + pageNum + '页失败: ' + e.message + '，跳过');
    }
  }

  // 第3步：最终保存
  console.log('\n[第3步] 保存最终结果...');
  console.log('  总计: ' + allProjects.length + ' 个唯一项目');

  // 按发证日期排序（最新在前）
  allProjects.sort(function(a, b) {
    return (b.issue_date || '').localeCompare(a.issue_date || '');
  });

  fs.writeFileSync(outFile, JSON.stringify(allProjects, null, 2), 'utf-8');
  console.log('  ✅ 已保存到: ' + outFile);

  // 统计
  var dates = allProjects.map(function(p) { return p.issue_date; }).filter(Boolean).sort();
  console.log('\n  最新日期: ' + (dates[dates.length - 1] || 'N/A'));
  console.log('  最早日期: ' + (dates[0] || 'N/A'));
  console.log('  含预售证号: ' + allProjects.filter(function(p) { return p.permit_no; }).length);

  console.log('\n=== 爬取完毕 ===');
}

main().catch(function(err) {
  console.error('❌ 爬虫失败:', err);
  process.exit(1);
});
