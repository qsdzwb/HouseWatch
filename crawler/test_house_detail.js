/**
 * 测试爬虫 v6：访问房屋详情页 pageId=373432
 * 目标：获取每套房的面积、价格等详细信息
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output_v6_test');
// 从分析结果中得到的真实 houseId
const TEST_HOUSE_URL = 'http://bjjs.zjw.beijing.gov.cn/eportal/ui?pageId=373432&houseId=17822464&houseNo=1%E5%8D%95%E5%85%83-801&categoryId=1&salePermitId=8205387&systemId=2';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('=== 测试房屋详情页 ===');
  console.log('URL:', TEST_HOUSE_URL);

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });

  console.log('\n[1] 访问房屋详情页...');
  await page.goto(TEST_HOUSE_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(5000);

  console.log('[2] 截图...');
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'house_detail.png'), fullPage: true });

  console.log('[3] 保存完整 HTML...');
  const fullHTML = await page.content();
  fs.writeFileSync(path.join(OUTPUT_DIR, 'house_detail.html'), fullHTML, 'utf-8');
  console.log('  HTML 大小:', fullHTML.length, '字节');

  console.log('[4] 提取房屋详情数据...');
  const houseData = await page.evaluate(() => {
    const result = {
      title: document.title,
      url: window.location.href,
      bodyText: (document.body?.innerText || '').substring(0, 3000),
      tables: [],
    };

    // 提取所有表格数据
    document.querySelectorAll('table').forEach((table, tIdx) => {
      const rows = [];
      table.querySelectorAll('tr').forEach(row => {
        const cells = [];
        row.querySelectorAll('td, th').forEach(cell => {
          cells.push({
            text: cell.innerText?.trim() || '',
            html: cell.innerHTML?.substring(0, 200) || '',
          });
        });
        if (cells.length > 0) rows.push(cells);
      });
      if (rows.length > 0) {
        result.tables.push({
          index: tIdx,
          rowCount: rows.length,
          rows: rows.slice(0, 100),
        });
      }
    });

    // 提取所有 label-value 对（常见详情页布局）
    const items = [];
    document.querySelectorAll('td, th, span, div, li').forEach(el => {
      const text = (el.innerText || el.textContent || '').trim();
      if (text && (text.includes('面积') || text.includes('价格') || text.includes('状态') || 
          text.includes('房型') || text.includes('用途') || text.includes('签约'))) {
        items.push(text.substring(0, 100));
      }
    });
    result.keyInfo = [...new Set(items)];  // 去重

    return result;
  });

  console.log('\n=== 房屋详情数据 ===');
  console.log('标题:', houseData.title);
  console.log('\nbodyText 前2000字:');
  console.log(houseData.bodyText.substring(0, 2000));
  console.log('\n表格数:', houseData.tables.length);
  houseData.tables.slice(0, 5).forEach(t => {
    console.log(`\n  表格[${t.index}] ${t.rowCount}行:`);
    t.rows.slice(0, 20).forEach((row, i) => {
      console.log(`    Row${i}:`, row.map(c => c.text).join(' | '));
    });
  });

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'house_data.json'),
    JSON.stringify(houseData, null, 2),
    'utf-8'
  );

  console.log('\n[5] 尝试提取所有房屋详情链接（从楼盘表页面）...');
  
  // 现在访问楼盘表页面，提取所有房屋链接
  const unitPageUrl = 'http://bjjs.zjw.beijing.gov.cn/eportal/ui?pageId=320833&systemId=2&categoryId=1&salePermitId=8205387&buildingId=577656';
  await page.goto(unitPageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(8000);

  const allHouseLinks = await page.evaluate(() => {
    const links = [];
    document.querySelectorAll('a[href*="houseId"]').forEach(a => {
      const href = a.href || '';
      const text = (a.innerText || a.textContent || '').trim();
      if (href && href.includes('houseId')) {
        // 从 href 中提取 houseId
        const match = href.match(/houseId=(\d+)/);
        if (match) {
          links.push({
            houseId: match[1],
            houseNo: text,
            href: href,
          });
        }
      }
    });

    // 如果没有 a[href*="houseId"]，尝试找所有 a 标签
    if (links.length === 0) {
      document.querySelectorAll('a').forEach(a => {
        const href = a.href || '';
        const text = (a.innerText || '').trim();
        if (href.includes('houseId') || href.includes('373432')) {
          const match = href.match(/houseId=(\d+)/);
          links.push({
            houseId: match ? match[1] : '',
            houseNo: text,
            href: href,
          });
        }
      });
    }

    return links;
  });

  console.log(`  找到 ${allHouseLinks.length} 个房屋详情链接:`);
  allHouseLinks.slice(0, 20).forEach(l => {
    console.log(`    houseId=${l.houseId}, 房号=${l.houseNo}`);
  });

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'all_house_links.json'),
    JSON.stringify(allHouseLinks, null, 2),
    'utf-8'
  );

  await browser.close();
  console.log('\n=== 测试完成 ===');
  console.log('输出目录:', OUTPUT_DIR);
}

main().catch(console.error);
