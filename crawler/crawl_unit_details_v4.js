/**
 * 北京住建委网签数据爬虫 v4 — 精准获取逐户楼层数据
 * 
 * 已知：
 * - 楼盘表"查看信息"链接: 
 *   pageId=320833&systemId=2&categoryId=1&salePermitId=<项目ID>&buildingId=<楼栋ID>
 * - 需要先从详情页提取每个楼栋对应的 buildingId
 * 
 * 本爬虫将：
 * 1. 访问详情页，提取楼盘表中每栋楼的 buildingId（从链接中）
 * 2. 逐个访问逐户页面，提取每套房的状态/面积/价格
 * 3. 保存结构化数据
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output_v4');
const BASE_URL = 'http://bjjs.zjw.beijing.gov.cn';
const PAGE_URL = `${BASE_URL}/eportal/ui`;

const SAMPLE_PROJECTS = [
  { name: '金阙华院', projectID: '8205387' },
  { name: '满和苑', projectID: '8203797' },
  { name: '铂瑞府', projectID: '8207359' },
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('=== 网签数据爬虫 v4 — 精准逐户数据 ===\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });

  const allResults = {};

  for (const project of SAMPLE_PROJECTS) {
    const detailUrl = `${PAGE_URL}?pageId=320794&projectID=${project.projectID}&systemID=2&srcId=1`;
    const projectDir = path.join(OUTPUT_DIR, project.name);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`项目: ${project.name} (ID: ${project.projectID})`);
    console.log(`${'='.repeat(60)}`);

    try {
      // ======== 第1步：访问详情页，提取楼栋信息（含 buildingId） ========
      console.log('\n[1/3] 访问详情页，提取楼栋 buildingId...');
      await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(4000);

      // 保存页面 HTML
      const detailHTML = await page.content();
      fs.writeFileSync(
        path.join(projectDir, 'detail_page.html'),
        detailHTML,
        'utf-8'
      );

      // 提取楼盘表中每栋楼的 buildingId
      const buildings = await page.evaluate(() => {
        const results = [];

        // 查找所有包含"查看信息"的链接
        const allLinks = document.querySelectorAll('a');
        allLinks.forEach(link => {
          const text = link.innerText?.trim() || '';
          const href = link.href || '';

          if (text === '查看信息' && href) {
            // 从 href 中提取 buildingId
            const url = new URL(href, window.location.origin);
            const buildingId = url.searchParams.get('buildingId') || '';
            const salePermitId = url.searchParams.get('salePermitId') || '';

            // 查找该链接所在行的楼号信息
            let buildingName = '';
            const row = link.closest('tr');
            if (row) {
              const firstCell = row.querySelector('td');
              buildingName = firstCell?.innerText?.trim() || '';
            }

            results.push({
              buildingName,
              buildingId,
              salePermitId,
              fullUrl: href,
              rowHTML: link.closest('tr')?.innerHTML?.substring(0, 500) || '',
            });
          }
        });

        return results;
      });

      console.log(`  发现 ${buildings.length} 个楼栋，含 buildingId:`);
      buildings.forEach((b, i) => {
        console.log(`    楼栋${i+1}: ${b.buildingName} → buildingId=${b.buildingId}`);
      });

      if (buildings.length === 0) {
        console.log('  ⚠️ 未找到楼栋链接，尝试从页面 HTML 中解析...');
        // 备用方案：从保存的 HTML 中用正则提取
        const html = detailHTML;
        const buildingIdMatches = html.matchAll(/buildingId=(\d+)/g);
        for (const match of buildingIdMatches) {
          console.log(`    正则匹配: buildingId=${match[1]}`);
        }
      }

      fs.writeFileSync(
        path.join(projectDir, 'buildings.json'),
        JSON.stringify(buildings, null, 2),
        'utf-8'
      );

      // ======== 第2步：逐个访问楼栋的逐户数据页面 ========
      console.log(`\n[2/3] 访问 ${buildings.length} 个楼栋的逐户数据页面...`);

      const allBuildingData = [];

      for (const [idx, building] of buildings.entries()) {
        if (!building.buildingId) {
          console.log(`  楼栋${idx+1}: 无 buildingId，跳过`);
          continue;
        }

        const unitUrl = `${PAGE_URL}?pageId=320833&systemId=2&categoryId=1&salePermitId=${building.salePermitId}&buildingId=${building.buildingId}`;
        console.log(`  楼栋${idx+1}: ${building.buildingName}`);
        console.log(`    访问: ${unitUrl.substring(0, 150)}`);

        try {
          await page.goto(unitUrl, { waitUntil: 'networkidle2', timeout: 60000 });
          await sleep(5000);

          // 截图
          await page.screenshot({
            path: path.join(projectDir, `building_${idx+1}_${building.buildingName}.png`),
            fullPage: true,
          });

          // 提取逐户数据
          const unitData = await page.evaluate(() => {
            const result = {
              title: document.title,
              url: window.location.href,
              bodyText: (document.body?.innerText || '').substring(0, 3000),
              tables: [],
              unitCells: [],
            };

            // 提取所有表格
            document.querySelectorAll('table').forEach((table, tIdx) => {
              const rows = [];
              table.querySelectorAll('tr').forEach(row => {
                const cells = [];
                row.querySelectorAll('td, th').forEach(cell => {
                  cells.push({
                    text: cell.innerText?.trim() || '',
                    html: cell.innerHTML?.substring(0, 200) || '',
                    className: cell.className || '',
                    // 检查是否有背景色（通常用于表示签约状态）
                    bgColor: cell.style?.backgroundColor || '',
                    color: cell.style?.color || '',
                  });
                });
                if (cells.length > 0) rows.push(cells);
              });
              if (rows.length > 0) {
                result.tables.push({
                  index: tIdx,
                  rowCount: rows.length,
                  rows: rows.slice(0, 200), // 最多200行
                });
              }
            });

            // 尝试按常见布局提取：每层一行，每套房一个单元格
            // 查找所有包含户型/房号信息的元素
            const allCells = document.querySelectorAll('td, th, div[class*="room"], div[class*="unit"]');
            allCells.forEach((cell, cIdx) => {
              const text = cell.innerText?.trim() || '';
              if (text && (text.includes('室') || text.includes('房') || 
                  text.includes('已售') || text.includes('未售') || 
                  /\d{3}/.test(text) || /[A-Z]?\d{2,3}/.test(text))) {
                result.unitCells.push({
                  index: cIdx,
                  text: text.substring(0, 100),
                  className: cell.className || '',
                  bgColor: cell.style?.backgroundColor || '',
                });
              }
            });

            return result;
          });

          console.log(`    标题: ${unitData.title}`);
          console.log(`    表格数: ${unitData.tables.length}`);
          console.log(`    单元格数: ${unitData.unitCells.length}`);
          console.log(`    bodyText 前200字: ${unitData.bodyText.substring(0, 200)}`);

          // 保存逐户数据
          const buildingResult = {
            buildingName: building.buildingName,
            buildingId: building.buildingId,
            url: unitUrl,
            data: unitData,
          };
          allBuildingData.push(buildingResult);

          fs.writeFileSync(
            path.join(projectDir, `building_${idx+1}_data.json`),
            JSON.stringify(buildingResult, null, 2),
            'utf-8'
          );

          console.log(`    数据已保存`);

        } catch (err) {
          console.log(`  楼栋${idx+1} 访问失败: ${err.message}`);
        }
      }

      // ======== 第3步：保存汇总 ========
      console.log(`\n[3/3] 保存项目汇总...`);
      
      const projectSummary = {
        project: project.name,
        projectID: project.projectID,
        buildingCount: buildings.length,
        buildings: buildings.map(b => ({
          name: b.buildingName,
          buildingId: b.buildingId,
        })),
        buildingDataCount: allBuildingData.length,
      };

      allResults[project.name] = projectSummary;

      fs.writeFileSync(
        path.join(projectDir, 'project_summary.json'),
        JSON.stringify(projectSummary, null, 2),
        'utf-8'
      );

      console.log(`  汇总已保存: ${allBuildingData.length}/${buildings.length} 个楼栋数据已获取`);

    } catch (err) {
      console.log(`  项目处理失败: ${err.message}`);
    }
  }

  // ======== 全局汇总 ========
  console.log(`\n${'='.repeat(60)}`);
  console.log('=== 所有项目汇总 ===');
  console.log(JSON.stringify(allResults, null, 2).substring(0, 2000));

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'all_projects_summary.json'),
    JSON.stringify(allResults, null, 2),
    'utf-8'
  );

  await browser.close();
  console.log('\n=== 爬虫 v4 执行完毕 ===');
  console.log(`输出目录: ${OUTPUT_DIR}`);
}

main().catch(console.error);
