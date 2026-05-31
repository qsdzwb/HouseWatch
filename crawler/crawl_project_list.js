/**
 * 北京住建委 — 楼盘列表全量爬虫
 *
 * 目标：pageId=307670，一次性爬取所有楼盘基本信息
 * 输出：output/project_list.json
 *
 * 用法：
 *   # 探索模式（先看页面结构）
 *   node crawler/crawl_project_list.js --explore
 *
 *   # 全量爬取
 *   node crawler/crawl_project_list.js
 *
 *   # 只爬前 N 页测试
 *   node crawler/crawl_project_list.js --pages=5
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output');
const LIST_FILE = path.join(OUTPUT_DIR, 'project_list.json');
const BASE_URL = 'http://bjjs.zjw.beijing.gov.cn';
const PAGE_URL = `${BASE_URL}/eportal/ui`;
const LIST_PAGE_ID = '307670';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const isExplore = args.includes('--explore');
  const maxPages = parseInt((args.find(a => a.startsWith('--pages=')) || '--pages=9999').split('=')[1], 10);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('=== 北京住建委楼盘列表全量爬虫 ===\n');
  console.log(`模式: ${isExplore ? '探索' : '爬取'} | 最大页数: ${maxPages}\n`);

  // Chrome 路径：环境变量 > 自动检测 > Mac 默认 > 系统 PATH
  var chromePath = process.env.CRAWL_CHROME_PATH || null;
  if (!chromePath) {
    // 自动检测常见路径
    var candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
      '/usr/bin/chromium-browser',           // Linux (dnf)
      '/usr/bin/chromium',                   // Linux (apt)
      '/usr/bin/google-chrome',              // Linux (deb)
      '/usr/bin/google-chrome-stable',       // Linux (rpm)
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (fs.existsSync(candidates[i])) { chromePath = candidates[i]; break; }
    }
  }
  if (!chromePath) {
    console.error('❌ 未找到 Chrome/Chromium，请设置 CRAWL_CHROME_PATH 环境变量');
    process.exit(1);
  }
  console.log('Chrome 路径:', chromePath);

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: chromePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });

  // 监听网络请求，捕获数据
  const capturedData = [];
  page.on('response', async (response) => {
    const url = response.url();
    try {
      const contentType = response.headers()['content-type'] || '';
      if (contentType.includes('json') || url.includes('query') || url.includes('list') || url.includes('search')) {
        const json = await response.json().catch(() => null);
        if (json && (json.rows || json.data || json.list || json.result)) {
          capturedData.push({ url, data: json });
          console.log(`  📡 捕获数据: ${url.substring(0, 100)}...`);
        }
      }
    } catch (e) {}
  });

  // ========== 第1步：访问列表页 ==========
  const listUrl = `${PAGE_URL}?pageId=${LIST_PAGE_ID}`;
  console.log(`[第1步] 访问列表页: ${listUrl}`);

  try {
    await page.goto(listUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  } catch (e) {
    console.log('  networkidle2 超时，继续等待...');
    await sleep(10000);
  }

  await sleep(8000); // 等待 portal JS 完全渲染

  // 截图 + 保存 HTML
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'list_page.png'),
    fullPage: false,
  });
  const html = await page.content();
  fs.writeFileSync(path.join(OUTPUT_DIR, 'list_page.html'), html, 'utf-8');
  console.log('  截图和 HTML 已保存');

  // ========== 第2步：分析页面结构 ==========
  console.log('\n[第2步] 分析页面结构...');

  const pageAnalysis = await page.evaluate(() => {
    const info = {
      url: window.location.href,
      title: document.title,
      iframes: [],
      tables: [],
      links: [],
      allText: (document.body?.innerText || '').substring(0, 3000),
      inputs: [],
      selects: [],
      buttons: [],
    };

    // iframe
    document.querySelectorAll('iframe').forEach((f, i) => {
      info.iframes.push({ index: i, id: f.id, name: f.name, src: f.src, className: f.className });
    });

    // 表格
    document.querySelectorAll('table').forEach((t, i) => {
      const rows = t.querySelectorAll('tr');
      const headerRow = rows[0];
      const headers = headerRow ? Array.from(headerRow.querySelectorAll('td, th')).map(c => (c.innerText || '').trim()) : [];
      info.tables.push({
        index: i,
        id: t.id,
        className: t.className,
        rowCount: rows.length,
        colCount: headers.length,
        headers: headers.slice(0, 15),
        firstDataRow: rows[1] ? Array.from(rows[1].querySelectorAll('td')).map(c => (c.innerText || '').trim()).slice(0, 6) : [],
      });
    });

    // 链接（含 projectID 的）
    document.querySelectorAll('a').forEach(a => {
      const href = a.href || '';
      if (href.includes('projectID')) {
        const url = new URL(href, window.location.origin);
        info.links.push({
          text: (a.innerText || '').trim().substring(0, 60),
          href: href.substring(0, 200),
          projectID: url.searchParams.get('projectID') || '',
          pageId: url.searchParams.get('pageId') || '',
        });
      }
    });

    // 搜索表单
    document.querySelectorAll('input, select, button').forEach(el => {
      const tag = el.tagName.toLowerCase();
      const entry = {
        tag,
        id: el.id,
        name: el.name,
        className: el.className,
        type: el.type || '',
        value: el.value || '',
        placeholder: el.placeholder || '',
        innerText: (el.innerText || '').trim().substring(0, 40),
      };
      if (tag === 'input') info.inputs.push(entry);
      else if (tag === 'select') info.selects.push(entry);
      else if (tag === 'button') info.buttons.push(entry);
    });

    // 分页
    const pageInfo = {};
    const paginationEl = document.querySelector('.pagination, .page, .pager, [class*="page"], [class*="pagin"]');
    if (paginationEl) {
      pageInfo.html = paginationEl.outerHTML.substring(0, 1000);
      pageInfo.text = (paginationEl.innerText || '').trim().substring(0, 500);
    }
    info.pagination = pageInfo;

    return info;
  });

  console.log(`  URL: ${pageAnalysis.url}`);
  console.log(`  标题: ${pageAnalysis.title}`);
  console.log(`  iframe数量: ${pageAnalysis.iframes.length}`);
  console.log(`  表格数量: ${pageAnalysis.tables.length}`);
  console.log(`  projectID链接数: ${pageAnalysis.links.length}`);
  console.log(`  input数量: ${pageAnalysis.inputs.length}`);
  console.log(`  select数量: ${pageAnalysis.selects.length}`);
  console.log(`  button数量: ${pageAnalysis.buttons.length}`);

  // 保存分析结果
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'page_analysis.json'),
    JSON.stringify(pageAnalysis, null, 2),
    'utf-8'
  );

  // 打印关键发现
  if (pageAnalysis.tables.length > 0) {
    console.log('\n  📊 发现的表格:');
    pageAnalysis.tables.forEach(t => {
      console.log(`    表格${t.index}: ${t.rowCount}行 × ${t.colCount}列`);
      console.log(`      表头: ${t.headers.join(' | ')}`);
      console.log(`      首行数据: ${t.firstDataRow.join(' | ')}`);
    });
  }

  if (pageAnalysis.links.length > 0) {
    console.log(`\n  🔗 前10个 projectID 链接:`);
    pageAnalysis.links.slice(0, 10).forEach(l => {
      console.log(`    ${l.projectID} — ${l.text}`);
    });
  }

  // ========== 第3步：如果有搜索结果，开始解析 ==========
  if (isExplore) {
    console.log('\n  ✅ 探索模式完毕，请查看 output/ 目录的分析文件');
    await browser.close();
    return;
  }

  // 尝试在 iframe 中查找表格
  let allProjects = [];
  let currentPage = 1;

  // 先尝试主页面提取
  if (pageAnalysis.links.length > 0) {
    console.log(`\n[第3步] 从当前页提取项目列表...`);

    const extractPage = async () => {
      return await page.evaluate(() => {
        const projects = [];
        const seen = new Set();

        // 方法1: 找到所有含 projectID 的链接
        // 列表页表格结构: 项目名称 | 预售证号 | 发证时间
        // district/developer/address 在列表页不可用，需从详情页获取
        document.querySelectorAll('a[href*="projectID"]').forEach(a => {
          const href = a.href || '';
          const url = new URL(href, window.location.origin);
          const pid = url.searchParams.get('projectID');
          const name = (a.innerText || '').trim();

          if (pid && name && !seen.has(pid) && name.length > 1 && name.length < 100) {
            seen.add(pid);
            let permitNo = '';
            let issueDate = '';
            let district = '';
            let developer = '';
            let address = '';

            const row = a.closest('tr');
            if (row) {
              const cells = row.querySelectorAll('td');
              const texts = Array.from(cells).map(c => (c.innerText || '').trim());
              // 表格: 项目名称(0) | 预售证号(1) | 发证时间(2)
              if (texts.length >= 2) permitNo = texts[1] || '';
              if (texts.length >= 3) issueDate = texts[2] || '';
            }

            projects.push({
              project_id: pid, name,
              permit_no: permitNo, issue_date: issueDate,
              district, developer, address,
            });
          }
        });

        // 方法2: 如果方法1没结果，从表格行解析
        if (projects.length === 0) {
          const tables = document.querySelectorAll('table');
          for (const table of tables) {
            const rows = table.querySelectorAll('tr');
            for (let i = 1; i < rows.length; i++) {
              const cells = rows[i].querySelectorAll('td');
              if (cells.length >= 2) {
                const nameCell = cells[0];
                const link = nameCell.querySelector('a');
                if (link) {
                  const href = link.href || '';
                  const pidMatch = href.match(/projectID=(\d+)/);
                  const name = (link.innerText || '').trim();
                  if (pidMatch && name && !seen.has(pidMatch[1])) {
                    seen.add(pidMatch[1]);
                    projects.push({
                      project_id: pidMatch[1],
                      name,
                      permit_no: cells[1] ? (cells[1].innerText || '').trim() : '',
                      issue_date: cells[2] ? (cells[2].innerText || '').trim() : '',
                      district: '',
                      developer: '',
                      address: '',
                    });
                  }
                }
              }
            }
          }
        }

        return projects;
      });
    };

    // 提取当前页
    let pageProjects = await extractPage();
    console.log(`  第${currentPage}页: ${pageProjects.length} 个项目`);
    allProjects = allProjects.concat(pageProjects);

    // 处理分页
    while (currentPage < maxPages) {
      // 查找"下一页"按钮
      const hasNext = await page.evaluate(() => {
        // 尝试各种分页选择器
        const selectors = [
          'a.next', '.next a', '[class*="next"]:not([class*="disabled"])',
          'a[onclick*="next"]', 'a[onclick*="page"]',
          '.pagination a:last-child', '.pager a:last-child',
          'a:contains("下一页")', 'a:contains("下页")', 'a:contains(">")',
          'input[type="button"][value*="下"]',
        ];

        for (const sel of selectors) {
          try {
            const el = document.querySelector(sel);
            if (el && !el.classList.contains('disabled')) {
              el.click();
              return true;
            }
          } catch (e) {}
        }

        // 文本匹配
        const allLinks = document.querySelectorAll('a');
        for (const a of allLinks) {
          const text = (a.innerText || '').trim();
          if ((text === '下一页' || text === '>' || text === '»') && !a.classList.contains('disabled')) {
            a.click();
            return true;
          }
        }

        // 页码按钮
        const pageBtns = document.querySelectorAll('[class*="page"]');
        for (const btn of pageBtns) {
          const text = (btn.innerText || '').trim();
          const nextNum = currentPage + 1;
          if (text === String(nextNum)) {
            btn.click();
            return true;
          }
        }

        return false;
      });

      if (!hasNext) {
        console.log('  已到最后一页');
        break;
      }

      currentPage++;
      console.log(`  跳转到第${currentPage}页...`);
      await sleep(8000); // 等待翻页渲染

      pageProjects = await extractPage();
      console.log(`  第${currentPage}页: ${pageProjects.length} 个项目`);

      if (pageProjects.length === 0) {
        console.log('  该页无数据，停止');
        break;
      }

      allProjects = allProjects.concat(pageProjects);

      // 每10页保存一次
      if (currentPage % 10 === 0) {
        fs.writeFileSync(LIST_FILE, JSON.stringify(allProjects, null, 2), 'utf-8');
        console.log(`  💾 已保存 ${allProjects.length} 个项目 (第${currentPage}页)`);
      }
    }
  }

  // 如果没有从页面提取到项目，检查网络捕获
  if (allProjects.length === 0 && capturedData.length > 0) {
    console.log('\n[备用方案] 从网络请求中提取项目数据...');
    for (const cap of capturedData) {
      const data = cap.data;
      let items = data.rows || data.data || data.list || data.result || [];
      if (Array.isArray(items)) {
        items.forEach(item => {
          allProjects.push({
            project_id: String(item.projectID || item.project_id || item.id || ''),
            name: item.name || item.projectName || item.project_name || '',
            permit_no: item.permitNo || item.permit_no || '',
            issue_date: item.issueDate || item.issue_date || '',
            district: item.district || item.area || '',
            developer: item.developer || '',
            address: item.address || item.location || '',
          });
        });
      }
    }
  }

  // ========== 第4步：保存结果 ==========
  // 去重
  const seen = new Set();
  const uniqueProjects = allProjects.filter(p => {
    if (!p.project_id || seen.has(p.project_id)) return false;
    seen.add(p.project_id);
    return true;
  });

  console.log(`\n[第4步] 保存结果...`);
  console.log(`  总计: ${allProjects.length} 条 (去重后: ${uniqueProjects.length} 条)`);

  fs.writeFileSync(LIST_FILE, JSON.stringify(uniqueProjects, null, 2), 'utf-8');
  console.log(`  ✅ 已保存到: ${LIST_FILE}`);

  // 打印统计
  if (uniqueProjects.length > 0) {
    const dates = uniqueProjects.map(p => p.issue_date).filter(Boolean).sort();
    console.log(`\n  最新日期: ${dates[dates.length - 1] || 'N/A'}`);
    console.log(`  最早日期: ${dates[0] || 'N/A'}`);

    const withPermit = uniqueProjects.filter(p => p.permit_no).length;
    console.log(`  含预售证号: ${withPermit}/${uniqueProjects.length}`);
  }

  await browser.close();
  console.log('\n=== 列表爬虫执行完毕 ===');
}

main().catch(err => {
  console.error('❌ 爬虫失败:', err);
  process.exit(1);
});
