/**
 * 北京住建委网签数据爬虫 v3 — 逐户楼层数据
 * 
 * 目标：从详情页的"楼盘表"→"查看信息"链接，获取每层每户的：
 * - 房间号/户型
 * - 签约状态（已签约/未签约/认购）
 * - 建筑面积
 * - 拟售价格 / 成交价格
 * 
 * 策略：
 * 1. 提取楼盘表中"查看信息"的 onclick/href 属性
 * 2. 监听新打开的窗口/弹窗，截获 URL
 * 3. 或者直接在页面中点击并捕获新页面内容
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output_v3');
const BASE_URL = 'http://bjjs.zjw.beijing.gov.cn';

const SAMPLE_PROJECTS = [
  { name: '金阙华院', projectID: '8205387', buildingCount: 1 },
  { name: '满和苑', projectID: '8203797', buildingCount: 2 },
  { name: '铂瑞府', projectID: '8207359', buildingCount: 19 },
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('=== 网签数据爬虫 v3 — 逐户楼层数据 ===\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-popup-blocking',  // 允许弹窗
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });

  // 保存页面 HTML 源码的目录
  const htmlDir = path.join(OUTPUT_DIR, 'html_sources');
  if (!fs.existsSync(htmlDir)) {
    fs.mkdirSync(htmlDir, { recursive: true });
  }

  // ======== 对每个项目执行 ========
  for (const project of SAMPLE_PROJECTS) {
    const detailUrl = `${BASE_URL}/eportal/ui?pageId=320794&projectID=${project.projectID}&systemID=2&srcId=1`;
    const projectDir = path.join(OUTPUT_DIR, project.name);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`项目: ${project.name} (ID: ${project.projectID})`);
    console.log(`详情页: ${detailUrl}`);
    console.log(`${'='.repeat(60)}`);

    try {
      // ======== 第1步：加载详情页并保存完整HTML ========
      console.log('\n[1/4] 加载详情页...');
      await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(3000);

      // 保存完整 HTML 源码
      const pageHTML = await page.content();
      fs.writeFileSync(
        path.join(htmlDir, `${project.name}_detail_source.html`),
        pageHTML,
        'utf-8'
      );

      // ======== 第2步：提取楼盘表链接信息（含 HTML 属性） ========
      console.log('[2/4] 提取楼盘表链接...');
      
      const buildingLinks = await page.evaluate(() => {
        const result = [];

        // 找到"楼盘表"标题所在表格的所有行
        const allTables = document.querySelectorAll('table');
        
        allTables.forEach((table, tableIdx) => {
          const rows = table.querySelectorAll('tr');
          let isBuildingTable = false;

          rows.forEach((row, rowIdx) => {
            // 如果发现有"楼盘表"或"查看信息"文本
            const rowText = row.innerText || '';
            
            if (rowText.includes('楼盘表') || rowText.includes('销售楼号') || isBuildingTable) {
              const cells = row.querySelectorAll('td');
              cells.forEach((td, tdIdx) => {
                // 提取完整的 innerHTML（而不仅是 innerText）
                const html = td.innerHTML?.trim() || '';
                const text = td.innerText?.trim() || '';
                
                // 查找其中的链接
                const links = td.querySelectorAll('a');
                links.forEach((link, linkIdx) => {
                  const linkData = {
                    tableIdx,
                    rowIdx,
                    tdIdx,
                    text: link.innerText?.trim() || '',
                    href: link.href || '',
                    onclick: link.getAttribute('onclick') || '',
                    target: link.target || '',
                    className: link.className || '',
                    id: link.id || '',
                  };
                  
                  // 获取链接的完整 HTML
                  linkData.outerHTML = link.outerHTML?.substring(0, 500) || '';
                  
                  // 获取该行中的楼号信息
                  const rowCells = row.querySelectorAll('td');
                  const rowData = [];
                  rowCells.forEach(c => {
                    const cellLinks = c.querySelectorAll('a');
                    if (cellLinks.length > 0) {
                      cellLinks.forEach(cl => {
                        rowData.push({
                          text: cl.innerText?.trim() || '',
                          href: cl.href || '',
                          onclick: cl.getAttribute('onclick') || '',
                          outerHTML: cl.outerHTML?.substring(0, 300) || '',
                        });
                      });
                    } else {
                      rowData.push(c.innerText?.trim() || '');
                    }
                  });
                  linkData.rowContext = rowData;
                  
                  result.push(linkData);
                });

                // 也检查是否有包含 onclick 但非 a 标签的元素（比如 span/div 带 onclick）
                if (text === '查看信息' && links.length === 0) {
                  const parent = td.parentElement;
                  if (parent) {
                    const clickableChildren = parent.querySelectorAll('[onclick]');
                    clickableChildren.forEach((el, elIdx) => {
                      result.push({
                        tableIdx,
                        rowIdx,
                        tdIdx,
                        text: el.innerText?.trim() || '',
                        href: el.href || '',
                        onclick: el.getAttribute('onclick') || '',
                        target: el.target || '',
                        className: el.className || '',
                        tagName: el.tagName,
                        outerHTML: el.outerHTML?.substring(0, 500) || '',
                        rowContext: Array.from(row.querySelectorAll('td')).map(c => c.innerText?.trim() || ''),
                      });
                    });
                  }
                }
              });
              
              if (rowText.includes('楼盘表') || rowText.includes('销售楼号')) {
                isBuildingTable = true;
              }
            }
          });
        });

        return result;
      });

      console.log(`  发现 ${buildingLinks.length} 个链接元素`);
      buildingLinks.forEach((link, idx) => {
        console.log(`  链接${idx+1}: text="${link.text}" href="${link.href.substring(0, 100)}" onclick="${link.onclick.substring(0, 100)}"`);
      });

      fs.writeFileSync(
        path.join(projectDir, 'building_links.json'),
        JSON.stringify(buildingLinks, null, 2),
        'utf-8'
      );

      // ======== 第3步：截获新窗口/新页面，尝试点击链接 ========
      console.log('\n[3/4] 点击"查看信息"链接，截获逐户数据...');

      const newPagePromise = new Promise((resolve) => {
        browser.once('targetcreated', target => resolve(target.page()));
      });

      // 尝试点击第一个"查看信息"链接
      let unitPage = null;
      let unitData = null;

      try {
        const clickResult = await page.evaluate(() => {
          // 查找所有包含"查看信息"的元素
          const allElements = document.querySelectorAll('a, span, td, [onclick]');
          const candidates = [];
          
          for (const el of allElements) {
            const text = el.innerText?.trim() || '';
            const onclick = el.getAttribute('onclick') || '';
            if (text === '查看信息' || onclick) {
              candidates.push({
                tag: el.tagName,
                text: text.substring(0, 50),
                onclick: onclick.substring(0, 200),
                class: el.className || '',
              });
            }
          }
          return candidates;
        });

        console.log(`  找到 ${clickResult.length} 个可点击候选:`, 
          JSON.stringify(clickResult.slice(0, 5), null, 2));

        // 直接在 page.evaluate 中点击并等待
        const clicked = await page.evaluate(() => {
          // 查找所有 a 标签，内容为 "查看信息"
          const links = document.querySelectorAll('a');
          for (const link of links) {
            if (link.innerText?.trim() === '查看信息') {
              link.click();
              return { clicked: true, tag: 'a', text: '查看信息' };
            }
          }
          
          // 尝试 span/td 中有 onclick 的
          const clickables = document.querySelectorAll('[onclick]');
          for (const el of clickables) {
            if (el.innerText?.trim() === '查看信息') {
              el.click();
              return { clicked: true, tag: el.tagName, text: '查看信息', onclick: el.getAttribute('onclick')?.substring(0, 200) };
            }
          }
          
          return { clicked: false, reason: '未找到可点击的查看信息元素' };
        });

        console.log(`  点击结果: ${JSON.stringify(clicked)}`);

        // 等待可能的新窗口/弹窗
        await sleep(5000);
        
        // 检查是否有弹出层（layer/lhgdialog）
        const popupContent = await page.evaluate(() => {
          // 检查常见的弹窗层
          const popupSelectors = [
            '.layui-layer-content',
            '.ui_content',
            '.xhOpener',  // layer/lhgdialog
            '[id*="layer"]',
            '[class*="dialog"]',
            '[class*="popup"]',
            '.ui-dialog',
          ];
          
          const results = [];
          for (const selector of popupSelectors) {
            const el = document.querySelector(selector);
            if (el && el.offsetHeight > 0) {
              results.push({
                selector,
                visible: true,
                text: (el.innerText || '').substring(0, 2000),
                html: (el.innerHTML || '').substring(0, 2000),
              });
            }
          }
          return results;
        });

        console.log(`  弹窗层检测: ${popupContent.length} 个可见弹窗`);
        if (popupContent.length > 0) {
          popupContent.forEach((p, i) => {
            console.log(`    弹窗${i+1} [${p.selector}]: ${p.text.substring(0, 200)}`);
          });
          
          // 额外截图（包含弹窗）
          await page.screenshot({
            path: path.join(projectDir, 'popup_screenshot.png'),
            fullPage: false,
          });
        }

        // 检查是否有新页面打开
        const pages = await browser.pages();
        console.log(`  当前打开 ${pages.length} 个页面`);
        
        for (let i = 0; i < pages.length; i++) {
          const p = pages[i];
          const url = p.url();
          console.log(`    页面${i}: ${url.substring(0, 120)}`);
          
          if (p !== page && url !== 'about:blank') {
            unitPage = p;
            try {
              await unitPage.waitForSelector('body', { timeout: 5000 });
              const content = await unitPage.content();
              const title = await unitPage.title();
              console.log(`    新页面标题: ${title}`);
              
              fs.writeFileSync(
                path.join(projectDir, 'unit_page_source.html'),
                content,
                'utf-8'
              );

              // 提取页面数据
              unitData = await unitPage.evaluate(() => {
                return {
                  title: document.title,
                  url: window.location.href,
                  bodyText: (document.body?.innerText || '').substring(0, 5000),
                  tables: Array.from(document.querySelectorAll('table')).map((table, idx) => ({
                    index: idx,
                    rows: Array.from(table.querySelectorAll('tr')).slice(0, 100).map(row => 
                      Array.from(row.querySelectorAll('td, th')).map(cell => ({
                        text: cell.innerText?.trim() || '',
                        html: cell.innerHTML?.substring(0, 300) || '',
                        colspan: cell.getAttribute('colspan') || '',
                        rowspan: cell.getAttribute('rowspan') || '',
                      }))
                    ),
                  })),
                };
              });

              fs.writeFileSync(
                path.join(projectDir, 'unit_data.json'),
                JSON.stringify(unitData, null, 2),
                'utf-8'
              );

              console.log(`    逐户数据已保存`);
              
              // 截图
              await unitPage.screenshot({
                path: path.join(projectDir, 'unit_page.png'),
                fullPage: true,
              });
            } catch (e) {
              console.log(`    处理新页面失败: ${e.message}`);
            }
          }
        }

        // 如果点出了弹窗但没有新页面，截图当前页面的弹窗
        if (!unitData && popupContent.length > 0) {
          // 尝试从弹窗中提取数据
          const popupData = await page.evaluate(() => {
            const tables = [];
            const layerSelectors = [
              '.layui-layer-content table',
              '.ui_content table',
              '.xhOpener table',
              '[class*="dialog"] table',
            ];
            
            for (const selector of layerSelectors) {
              const tbls = document.querySelectorAll(selector);
              tbls.forEach(t => {
                const rows = Array.from(t.querySelectorAll('tr')).slice(0, 100).map(row =>
                  Array.from(row.querySelectorAll('td, th')).map(cell => 
                    cell.innerText?.trim() || ''
                  )
                );
                if (rows.length > 0) tables.push({ selector, rows });
              });
            }
            return tables;
          });

          unitData = { popupData, source: 'popup' };
          fs.writeFileSync(
            path.join(projectDir, 'popup_data.json'),
            JSON.stringify(popupData, null, 2),
            'utf-8'
          );
          console.log(`  弹窗数据: 发现 ${popupData.length} 个表格`);
        }

      } catch (err) {
        console.log(`  点击/提取失败: ${err.message}`);
      }

      // ======== 第4步：保存汇总结果 ========
      console.log('\n[4/4] 保存汇总...');

      const summary = {
        project: project.name,
        projectID: project.projectID,
        buildingLinks: buildingLinks.length,
        unitDataCaptured: !!unitData,
        unitDataPreview: unitData ? 
          JSON.stringify(unitData).substring(0, 2000) : 
          '未获取到逐户数据',
        files: fs.readdirSync(projectDir),
      };

      fs.writeFileSync(
        path.join(projectDir, 'summary.json'),
        JSON.stringify(summary, null, 2),
        'utf-8'
      );

      console.log(`  汇总已保存: ${JSON.stringify(summary, null, 2).substring(0, 500)}`);

    } catch (err) {
      console.log(`  项目处理失败: ${err.message}`);
    }
  }

  await browser.close();
  console.log('\n=== 爬虫 v3 执行完毕 ===');
  console.log(`输出目录: ${OUTPUT_DIR}`);
}

main().catch(console.error);
