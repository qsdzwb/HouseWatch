/**
 * 北京住建委网签数据爬虫 v5 — 完整逐户数据
 * 
 * 数据获取路径（已验证）：
 * 1. 列表页: pageId=307670 → 获取项目列表
 * 2. 详情页: pageId=320794&projectID=<ID> → 获取楼栋列表 + buildingId
 * 3. 楼盘表: pageId=320833&buildingId=<ID> → 获取每套房状态（背景色）+ houseId 链接
 * 4. 房屋详情: pageId=373432&houseId=<ID> → 获取每套房面积/户型/拟售单价
 * 
 * 状态颜色对应（已验证）：
 *   rgb(204,204,204) → 不可售（灰色）
 *   rgb(51,204,0)   → 可售（绿色）
 *   rgb(255,204,153) → 已预订（橙色）
 *   rgb(255,0,0)     → 已签约（红色）
 *   rgb(255,255,0)   → 已办理预售项目抵押（黄色）
 *   rgb(210,105,30)  → 网上联机备案（棕色）
 *   rgb(0,255,255)   → 资格核验中（青色）
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output_v5_final');
const BASE_URL = 'http://bjjs.zjw.beijing.gov.cn';
const PAGE_URL = `${BASE_URL}/eportal/ui`;

// 状态颜色映射
const STATUS_COLORS = {
  'rgb(204, 204, 204)': '不可售',
  'rgb(51, 204, 0)': '可售',
  'rgb(255, 204, 153)': '已预订',
  'rgb(255, 0, 0)': '已签约',
  'rgb(255, 255, 0)': '已办理预售项目抵押',
  'rgb(210, 105, 30)': '网上联机备案',
  'rgb(0, 255, 255)': '资格核验中',
};

const SAMPLE_PROJECTS = [
  { name: '金阙华院', projectID: '8205387' },
  { name: '满和苑', projectID: '8203797' },
  { name: '铂瑞府', projectID: '8207359' },
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 从楼盘表页面提取所有房屋的状态和链接
 */
async function extractUnitDataFromPage(page) {
  const result = await page.evaluate(() => {
    const STATUS_COLORS = {
      'rgb(204, 204, 204)': '不可售',
      'rgb(51, 204, 0)': '可售',
      'rgb(255, 204, 153)': '已预订',
      'rgb(255, 0, 0)': '已签约',
      'rgb(255, 255, 0)': '已办理预售项目抵押',
      'rgb(210, 105, 30)': '网上联机备案',
      'rgb(0, 255, 255)': '资格核验中',
    };

    const units = [];

    // 方法1：查找所有包含房号的 div（有背景色 = 有状态）
    // 从测试结果看，房号是在 <td colspan="7"> 内的 div
    const allDivs = document.querySelectorAll('td[colspan="7"] div, td[id*="tdcowspan"] div, .fwgl_right div');
    
    allDivs.forEach(div => {
      const text = (div.innerText || div.textContent || '').trim();
      // 匹配房号模式：1单元-801, 2单元-101 等
      if (/^\d+单元-\d+$/.test(text) || /^[A-Z]?\d{3}[A-Z]?$/.test(text)) {
        const style = div.style || {};
        const bg = style.backgroundColor || '';
        
        // 也检查 parentNode 的样式
        let status = STATUS_COLORS[bg] || '';
        if (!status && div.parentElement) {
          const parentBg = window.getComputedStyle(div.parentElement).backgroundColor;
          status = STATUS_COLORS[parentBg] || '';
        }

        const unitData = {
          roomNo: text,
          status: status,
          bgColor: bg,
          hasLink: false,
          houseId: '',
          detailUrl: '',
        };

        // 检查是否有链接
        const link = div.querySelector('a') || div.closest('a');
        if (link && link.href) {
          unitData.hasLink = true;
          unitData.detailUrl = link.href;
          const match = link.href.match(/houseId=(\d+)/);
          if (match) unitData.houseId = match[1];
        } else {
          // 也可能是 div 被包在 a 里
          const parentA = div.closest('a');
          if (parentA && parentA.href) {
            unitData.hasLink = true;
            unitData.detailUrl = parentA.href;
            const match = parentA.href.match(/houseId=(\d+)/);
            if (match) unitData.houseId = match[1];
          }
        }

        units.push(unitData);
      }
    });

    // 方法2：如果从 div 中没找到足够的房号，尝试从表格的第三列解析
    // 表头是：自然楼层 | 销售楼层 | 房号
    if (units.length === 0) {
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const headerCells = table.querySelectorAll('tr:first-child td, tr:first-child th');
        let isFloorTable = false;
        headerCells.forEach(cell => {
          if ((cell.innerText || '').includes('房') && (cell.innerText || '').includes('号')) isFloorTable = true;
        });

        if (isFloorTable) {
          const rows = table.querySelectorAll('tr');
          for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 3) {
              const floorText = (cells[0]?.innerText || '').trim();
              const saleFloor = (cells[1]?.innerText || '').trim();
              const roomText = (cells[2]?.innerText || '').trim();
              
              if (roomText && /单元-\d+/.test(roomText)) {
                // roomText 可能包含多个房号（换行分隔）
                const roomNos = roomText.split('\n').map(s => s.trim()).filter(Boolean);
                roomNos.forEach(roomNo => {
                  units.push({
                    roomNo: roomNo,
                    floor: floorText,
                    saleFloor: saleFloor,
                    status: '',
                    bgColor: '',
                    hasLink: false,
                    houseId: '',
                    detailUrl: '',
                  });
                });
              }
            }
          }
        }
      }
    }

    return units;
  });

  return result;
}

/**
 * 从房屋详情页提取数据
 */
async function extractHouseDetail(page) {
  const detail = await page.evaluate(() => {
    const result = {
        roomNo: '',
        purpose: '',      // 规划设计用途
        layout: '',       // 户型
        buildArea: '',    // 建筑面积
        innerArea: '',    // 套内面积
        pricePerSqM: '', // 按建筑面积拟售单价
        pricePerSqMInner: '', // 按套内面积拟售单价
        allText: (document.body?.innerText || '').substring(0, 5000),
      };

    // 从表格中提取（房屋资料表格）
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const label = (cells[0]?.innerText || '').trim();
          const value = (cells[1]?.innerText || '').trim();
          
          // 注意：标签中有全角空格（如"户　　型"），需要分别检查
          if (label.includes('房') && label.includes('间') && label.includes('号')) result.roomNo = value;
          if (label.includes('用途') || (label.includes('规划') && label.includes('设计'))) result.purpose = value;
          if (label.includes('户') && label.includes('型')) result.layout = value;
          // 精确匹配"建筑面积"，排除"按建筑面积拟售单价"
          if (label === '建筑面积' || (label.includes('建筑面积') && !label.includes('套内') && !label.includes('拟售') && !label.includes('按'))) result.buildArea = value;
          if (label.includes('套内') && label.includes('面积') && !label.includes('拟售')) result.innerArea = value;
          if (label.includes('建筑面积') && label.includes('拟售')) result.pricePerSqM = value;
          if (label.includes('套内面积') && label.includes('拟售')) result.pricePerSqMInner = value;
        }
      }
    }

    // 备用：从 bodyText 中用正则提取
    const text = document.body?.innerText || '';
    const roomMatch = text.match(/房\s*间\s*号\s*(\S+)/);
    if (!result.roomNo && roomMatch) result.roomNo = roomMatch[1];
    
    // 精确匹配建筑面积（不含拟售/套内）—— 第一个"建筑面积.*平方米"
    const buildMatch = text.match(/建筑面积[^按套]*?(\d+\.?\d*)\s*平方米/);
    if (!result.buildArea && buildMatch) result.buildArea = buildMatch[1] + ' 平方米';
    
    // 精确匹配拟售单价
    const priceMatch = text.match(/按建筑面积拟售单价\s*(\d+)\s*元/);
    if (!result.pricePerSqM && priceMatch) result.pricePerSqM = priceMatch[1] + ' 元/平方米';

    // 户型匹配（处理全角空格）
    const layoutMatch = text.match(/户\s*型\s*([^\n]+)/);
    if (!result.layout && layoutMatch) result.layout = layoutMatch[1].trim().split('\n')[0];

    return result;
  });

  return detail;
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('=== 网签数据爬虫 v5 — 完整逐户数据 ===\n');
  console.log('状态颜色映射:', JSON.stringify(STATUS_COLORS, null, 2));

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--no-sandbox',
      '--disable-set-uid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
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
      // ===== 第1步：访问详情页，提取楼栋 buildingId =====
      console.log('\n[第1步] 访问详情页，提取楼栋...');
      await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(4000);

      const buildings = await page.evaluate(() => {
        const results = [];
        const allLinks = document.querySelectorAll('a');
        allLinks.forEach(link => {
          const text = (link.innerText || '').trim();
          const href = link.href || '';
          if (text === '查看信息' && href && href.includes('buildingId')) {
            const url = new URL(href, window.location.origin);
            const buildingId = url.searchParams.get('buildingId') || '';
            const salePermitId = url.searchParams.get('salePermitId') || '';
            
            let buildingName = '';
            const row = link.closest('tr');
            if (row) {
              const firstCell = row.querySelector('td');
              buildingName = (firstCell?.innerText || '').trim();
            }

            results.push({
              buildingName,
              buildingId,
              salePermitId,
              fullUrl: href,
            });
          }
        });
        return results;
      });

      console.log(`  发现 ${buildings.length} 个楼栋:`);
      buildings.forEach((b, i) => {
        console.log(`    楼栋${i + 1}: ${b.buildingName} → buildingId=${b.buildingId}`);
      });

      if (buildings.length === 0) {
        console.log('  ⚠️ 未找到楼栋，跳过该项目');
        continue;
      }

      // ===== 第2步：逐个访问楼栋的楼盘表页面，提取每套房状态 =====
      console.log(`\n[第2步] 访问 ${buildings.length} 个楼栋的楼盘表页面...`);
      
      const projectData = {
        project: project.name,
        projectID: project.projectID,
        buildings: [],
      };

      for (const [idx, building] of buildings.entries()) {
        const unitUrl = `${PAGE_URL}?pageId=320833&systemId=2&categoryId=1&salePermitId=${building.salePermitId}&buildingId=${building.buildingId}`;
        
        console.log(`\n  楼栋${idx + 1}/${buildings.length}: ${building.buildingName}`);
        console.log(`    访问: ${unitUrl.substring(0, 120)}...`);

        try {
          await page.goto(unitUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await sleep(8000); // 等待 JS 渲染楼盘表

          // 截图
          await page.screenshot({
            path: path.join(projectDir, `building_${idx + 1}_${building.buildingName}.png`),
            fullPage: true,
          });

          // 提取所有房屋数据
          const units = await extractUnitDataFromPage(page);
          console.log(`    提取到 ${units.length} 套房数据`);

          // 如果没有提取到数据，保存 HTML 用于调试
          if (units.length === 0) {
            const debugHtml = await page.content();
            fs.writeFileSync(
              path.join(projectDir, `debug_building_${idx + 1}.html`),
              debugHtml,
              'utf-8'
            );
            console.log(`    ⚠️ 未提取到房屋数据，已保存 debug HTML`);
          }

          // ===== 第3步：访问每套房的详情页 =====
          const unitsWithDetails = [];
          const housesToFetch = units.filter(u => u.houseId);
          
          console.log(`    其中 ${housesToFetch.length} 套有详情链接，正在获取详情...`);

          for (const [hIdx, unit] of housesToFetch.entries()) {
            try {
              const detailUrl = `${PAGE_URL}?pageId=373432&houseId=${unit.houseId}&categoryId=1&salePermitId=${building.salePermitId}&systemId=2`;
              await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
              await sleep(2000);

              const detail = await extractHouseDetail(page);
              unitsWithDetails.push({
                ...unit,
                detail: detail,
              });

              if ((hIdx + 1) % 5 === 0) {
                console.log(`    已获取 ${hIdx + 1}/${housesToFetch.length} 套详情...`);
              }
            } catch (err) {
              console.log(`    ⚠️ 获取房屋 ${unit.roomNo} 详情失败: ${err.message}`);
              unitsWithDetails.push({
                ...unit,
                detail: null,
              });
            }
          }

          // 没有详情链接的房子（已签约/不可售等），只保存状态
          units.filter(u => !u.houseId).forEach(u => {
            unitsWithDetails.push({
              ...u,
              detail: null,
            });
          });

          const buildingResult = {
            buildingName: building.buildingName,
            buildingId: building.buildingId,
            unitCount: unitsWithDetails.length,
            units: unitsWithDetails,
          };

          projectData.buildings.push(buildingResult);

          // 每栋楼保存一次
          fs.writeFileSync(
            path.join(projectDir, `building_${idx + 1}_data.json`),
            JSON.stringify(buildingResult, null, 2),
            'utf-8'
          );

          console.log(`    ✅ 楼栋数据已保存: ${unitsWithDetails.length} 套房`);

        } catch (err) {
          console.log(`  ❌ 楼栋${idx + 1} 处理失败: ${err.message}`);
        }
      }

      // ===== 第4步：保存项目汇总 =====
      console.log(`\n[第3步] 保存项目汇总...`);
      fs.writeFileSync(
        path.join(projectDir, 'project_summary.json'),
        JSON.stringify(projectData, null, 2),
        'utf-8'
      );
      console.log(`  ✅ 项目汇总已保存`);

      allResults[project.name] = {
        projectID: project.projectID,
        buildingCount: projectData.buildings.length,
        totalUnits: projectData.buildings.reduce((sum, b) => sum + b.unitCount, 0),
      };

    } catch (err) {
      console.log(`  ❌ 项目处理失败: ${err.message}`);
    }
  }

  // ===== 全局汇总 =====
  console.log(`\n${'='.repeat(60)}`);
  console.log('=== 所有项目汇总 ===');
  console.log(JSON.stringify(allResults, null, 2));

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'all_projects_summary.json'),
    JSON.stringify(allResults, null, 2),
    'utf-8'
  );

  await browser.close();
  console.log('\n=== 爬虫 v5 执行完毕 ===');
  console.log(`输出目录: ${OUTPUT_DIR}`);
}

main().catch(console.error);
