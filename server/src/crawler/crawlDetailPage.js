const { newPage } = require('./browser');
const config = require('../config');

/**
 * 辅助：延迟
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Layer 2: 详情页爬虫 — 提取楼栋列表 + 项目成交数据
 * 
 * 访问 pageId=320794&projectID=<ID>
 * 提取所有"查看信息"链接 → 解析 buildingId, buildingName, salePermitId
 * 同时提取页面上的签约套数、签约面积、均价
 */
async function crawlDetailPage(projectID) {
  const page = await newPage();
  const url = `${config.crawl.pageUrl}?pageId=320794&projectID=${projectID}&systemID=2&srcId=1`;

  console.log(`  [Layer 2] 访问详情页: projectID=${projectID}`);

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(4000);

    const result = await page.evaluate(() => {
      const buildings = [];
      const allLinks = document.querySelectorAll('a');

      allLinks.forEach(link => {
        const text = (link.innerText || '').trim();
        const href = link.href || '';

        if (text === '查看信息' && href && href.includes('buildingId')) {
          const urlObj = new URL(href, window.location.origin);
          const buildingId = urlObj.searchParams.get('buildingId') || '';
          const salePermitId = urlObj.searchParams.get('salePermitId') || '';

          let buildingName = '';
          const row = link.closest('tr');
          if (row) {
            const firstCell = row.querySelector('td');
            buildingName = (firstCell?.innerText || '').trim();
          }

          buildings.push({ buildingName, buildingId, salePermitId });
        }
      });

      // 提取项目成交数据
      let signedCount = 0;
      let signedArea = 0;
      let avgPrice = 0;

      const pageText = document.body?.innerText || '';

      // 正则提取（适配北京住建委页面格式）
      // 示例：签约套数：10 | 签约面积：1234.5 | 均价：50000
      const countMatch = pageText.match(/签约套数[：:\s]*([\d,.]+)/);
      const areaMatch = pageText.match(/签约面积[：:\s]*([\d,.]+)/);
      const priceMatch = pageText.match(/均价[：:\s]*([\d,.]+)/);

      if (countMatch) signedCount = parseFloat(countMatch[1].replace(/,/g, ''));
      if (areaMatch) signedArea = parseFloat(areaMatch[1].replace(/,/g, ''));
      if (priceMatch) avgPrice = parseFloat(priceMatch[1].replace(/,/g, ''));

      // 备用方案：从表格 td 中提取
      if (!signedCount || !signedArea || !avgPrice) {
        const tables = document.querySelectorAll('table');
        tables.forEach(table => {
          const rows = table.querySelectorAll('tr');
          rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            for (let i = 0; i < cells.length; i++) {
              const cellText = (cells[i]?.innerText || '').trim();
              if (cellText.includes('签约套数') && i + 1 < cells.length) {
                const val = parseFloat((cells[i+1]?.innerText || '').replace(/,/g, ''));
                if (!isNaN(val)) signedCount = val;
              }
              if (cellText.includes('签约面积') && i + 1 < cells.length) {
                const val = parseFloat((cells[i+1]?.innerText || '').replace(/,/g, ''));
                if (!isNaN(val)) signedArea = val;
              }
              if (cellText.includes('均价') && i + 1 < cells.length) {
                const val = parseFloat((cells[i+1]?.innerText || '').replace(/,/g, ''));
                if (!isNaN(val)) avgPrice = val;
              }
            }
          });
        });
      }

      return { 
        buildings, 
        projectStats: { signedCount, signedArea, avgPrice } 
      };
    });

    const { buildings, projectStats } = result;

    console.log(`  [Layer 2] 发现 ${buildings.length} 个楼栋，签约${projectStats.signedCount}套/${projectStats.signedArea}㎡/均价${projectStats.avgPrice}`);

    return { buildings, projectStats };
  } catch (err) {
    console.error(`  [Layer 2] 详情页抓取失败: ${err.message}`);
    throw err;
  } finally {
    await page.close();
  }
}

module.exports = { crawlDetailPage };
