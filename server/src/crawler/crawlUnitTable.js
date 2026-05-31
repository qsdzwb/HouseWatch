const { newPage } = require('./browser');
const config = require('../config');

/**
 * 辅助：延迟
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Layer 3: 楼盘表爬虫 — 提取每套房的销售状态和 houseId
 * 
 * 访问 pageId=320833&buildingId=<ID>&salePermitId=<ID>
 * 通过 div 背景色识别状态，提取可售房屋的 houseId 链接
 */
async function crawlUnitTable(buildingId, salePermitId) {
  const page = await newPage();
  const url = `${config.crawl.pageUrl}?pageId=320833&systemId=2&categoryId=1&salePermitId=${salePermitId}&buildingId=${buildingId}`;

  console.log(`    [Layer 3] 楼盘表: buildingId=${buildingId}`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(8000); // 等待 JS 渲染

    const units = await page.evaluate((statusColorMap) => {
      const units = [];

      // 方法1：查找 td[colspan="7"] 内的 div（逐户色块）
      const allDivs = document.querySelectorAll(
        'td[colspan="7"] div, td[id*="tdcowspan"] div, .fwgl_right div'
      );

      allDivs.forEach(div => {
        const text = (div.innerText || div.textContent || '').trim();
        // 房号模式：1单元-801
        if (/^\d+单元-\d+$/.test(text) || /^[A-Z]?\d{3,4}[A-Z]?$/.test(text)) {
          const style = div.style || {};
          let bg = style.backgroundColor || '';

          // 也检查 computed style
          if (!bg) {
            bg = window.getComputedStyle(div).backgroundColor || '';
          }
          // 检查父元素
          if ((!bg || bg === 'rgba(0, 0, 0, 0)') && div.parentElement) {
            bg = window.getComputedStyle(div.parentElement).backgroundColor || '';
          }

          const status = statusColorMap[bg] || '未知';

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
          if (link && link.href && link.href !== '#' && !link.href.endsWith('#')) {
            unitData.hasLink = true;
            unitData.detailUrl = link.href;
            const match = link.href.match(/houseId=(\d+)/);
            if (match) unitData.houseId = match[1];
          }

          units.push(unitData);
        }
      });

      // 方法2（备用）：从表格第三列解析房号
      if (units.length === 0) {
        const tables = document.querySelectorAll('table');
        for (const table of tables) {
          const headerCells = table.querySelectorAll('tr:first-child td, tr:first-child th');
          let isFloorTable = false;
          headerCells.forEach(cell => {
            const txt = (cell.innerText || '');
            if (txt.includes('房') && txt.includes('号')) isFloorTable = true;
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
                  const roomNos = roomText.split('\n').map(s => s.trim()).filter(Boolean);
                  roomNos.forEach(roomNo => {
                    units.push({
                      roomNo,
                      floor: floorText,
                      saleFloor,
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
    }, config.statusColors);

    console.log(`    [Layer 3] 提取到 ${units.length} 套房数据`);
    return units;
  } catch (err) {
    console.error(`    [Layer 3] 楼盘表抓取失败: ${err.message}`);
    throw err;
  } finally {
    await page.close();
  }
}

module.exports = { crawlUnitTable };
