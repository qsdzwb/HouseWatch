const { newPage } = require('./browser');
const config = require('../config');

/**
 * 辅助：延迟
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Layer 2: 详情页爬虫 — 提取楼栋列表
 * 
 * 访问 pageId=320794&projectID=<ID>
 * 提取所有"查看信息"链接 → 解析 buildingId, buildingName, salePermitId
 */
async function crawlDetailPage(projectID) {
  const page = await newPage();
  const url = `${config.crawl.pageUrl}?pageId=320794&projectID=${projectID}&systemID=2&srcId=1`;

  console.log(`  [Layer 2] 访问详情页: projectID=${projectID}`);

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(4000);

    const buildings = await page.evaluate(() => {
      const results = [];
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

          results.push({ buildingName, buildingId, salePermitId });
        }
      });

      return results;
    });

    console.log(`  [Layer 2] 发现 ${buildings.length} 个楼栋`);
    return buildings;
  } catch (err) {
    console.error(`  [Layer 2] 详情页抓取失败: ${err.message}`);
    throw err;
  } finally {
    await page.close();
  }
}

module.exports = { crawlDetailPage };
