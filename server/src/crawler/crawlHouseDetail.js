const { newPage } = require('./browser');
const config = require('../config');

/**
 * 辅助：延迟
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Layer 4: 房屋详情爬虫 — 提取面积、户型、拟售单价
 * 
 * 访问 pageId=373432&houseId=<ID>
 * 从房屋资料表格中解析6个关键字段
 */
async function crawlHouseDetail(houseId, salePermitId) {
  const page = await newPage();
  const url = `${config.crawl.pageUrl}?pageId=373432&houseId=${houseId}&categoryId=1&salePermitId=${salePermitId}&systemId=2`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);

    const detail = await page.evaluate(() => {
      const result = {
        roomNo: '',
        purpose: '',
        layout: '',
        buildArea: '',
        innerArea: '',
        pricePerSqM: '',
        pricePerSqMInner: '',
      };

      // 从表格中提取
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const rows = table.querySelectorAll('tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const label = (cells[0]?.innerText || '').trim();
            const value = (cells[1]?.innerText || '').trim();

            if (label.includes('房') && label.includes('间') && label.includes('号'))
              result.roomNo = value;
            if (label.includes('用途') || (label.includes('规划') && label.includes('设计')))
              result.purpose = value;
            if (label.includes('户') && label.includes('型'))
              result.layout = value;
            if (
              label === '建筑面积' ||
              (label.includes('建筑面积') && !label.includes('套内') && !label.includes('拟售') && !label.includes('按'))
            )
              result.buildArea = value;
            if (label.includes('套内') && label.includes('面积') && !label.includes('拟售'))
              result.innerArea = value;
            if (label.includes('建筑面积') && label.includes('拟售'))
              result.pricePerSqM = value;
            if (label.includes('套内面积') && label.includes('拟售'))
              result.pricePerSqMInner = value;
          }
        }
      }

      // 备用：正则从 bodyText 提取
      const text = document.body?.innerText || '';

      const roomMatch = text.match(/房\s*间\s*号\s*(\S+)/);
      if (!result.roomNo && roomMatch) result.roomNo = roomMatch[1];

      const buildMatch = text.match(/建筑面积[^按套]*?(\d+\.?\d*)\s*平方米/);
      if (!result.buildArea && buildMatch) result.buildArea = buildMatch[1] + ' 平方米';

      const priceMatch = text.match(/按建筑面积拟售单价\s*(\d+)\s*元/);
      if (!result.pricePerSqM && priceMatch) result.pricePerSqM = priceMatch[1] + ' 元/平方米';

      const layoutMatch = text.match(/户\s*型\s*([^\n]+)/);
      if (!result.layout && layoutMatch) result.layout = layoutMatch[1].trim().split('\n')[0];

      return result;
    });

    return detail;
  } catch (err) {
    console.error(`    [Layer 4] 房屋详情抓取失败 (houseId=${houseId}): ${err.message}`);
    return null;
  } finally {
    await page.close();
  }
}

module.exports = { crawlHouseDetail };
