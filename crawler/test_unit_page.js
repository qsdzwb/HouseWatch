/**
 * 测试爬虫：深入分析 pageId=320833 楼盘表页面结构
 * 目标：搞清楚页面是怎么渲染楼盘表的（表格？Canvas？图片？）
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output_v5_test');
const TARGET_URL = 'http://bjjs.zjw.beijing.gov.cn/eportal/ui?pageId=320833&systemId=2&categoryId=1&salePermitId=8205387&buildingId=577656';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('=== 测试楼盘表页面结构 ===');
  console.log('URL:', TARGET_URL);

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });

  console.log('\n[1] 访问楼盘表页面...');
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  console.log('[2] 等待 8 秒让 JS 执行...');
  await sleep(8000);

  console.log('[3] 保存完整 HTML...');
  const fullHTML = await page.content();
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'unit_page_full.html'),
    fullHTML,
    'utf-8'
  );
  console.log('  HTML 大小:', fullHTML.length, '字节');

  console.log('[4] 截图...');
  await page.screenshot({
    path: path.join(OUTPUT_DIR, 'unit_page_full.png'),
    fullPage: true,
  });

  console.log('[5] 分析页面结构...');
  const analysis = await page.evaluate(() => {
    const result = {
      title: document.title,
      // 查找所有 canvas
      canvasCount: document.querySelectorAll('canvas').length,
      canvasInfo: [],
      // 查找所有 iframe
      iframeCount: document.querySelectorAll('iframe').length,
      iframeSrcs: [],
      // 查找所有 table
      tableCount: document.querySelectorAll('table').length,
      // 查找所有带背景色的元素
      coloredElements: 0,
      // 查找"房号"相关的链接
      roomLinks: [],
      // 查找 svg
      svgCount: document.querySelectorAll('svg').length,
      // 页面所有 div 的 class 包含 room/unit/floor 的
      roomDivs: [],
      // 检查是否有特定的楼盘表容器
      lpbContainers: [],
    };

    // Canvas 信息
    document.querySelectorAll('canvas').forEach((c, i) => {
      result.canvasInfo.push({
        index: i,
        width: c.width,
        height: c.height,
        className: c.className || '',
        id: c.id || '',
      });
    });

    // iframe src
    document.querySelectorAll('iframe').forEach((f, i) => {
      result.iframeSrcs.push(f.src || '');
    });

    // 带背景色的元素
    const allEls = document.querySelectorAll('*');
    let coloredCount = 0;
    for (let i = 0; i < allEls.length; i++) {
      const el = allEls[i];
      const bg = el.style?.backgroundColor || el.style?.background || '';
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        coloredCount++;
      }
      // 也检查计算样式
      try {
        const computed = window.getComputedStyle(el);
        const computedBg = computed.backgroundColor;
        if (computedBg && computedBg !== 'rgba(0, 0, 0, 0)' && computedBg !== 'transparent') {
          // 只记录前 20 个
          if (result.coloredElements < 20) {
            result.roomLinks.push({
              tag: el.tagName,
              class: el.className,
              bg: computedBg,
              text: (el.innerText || '').substring(0, 30),
            });
          }
          coloredCount++;
        }
      } catch (e) {}
    }
    result.coloredElements = coloredCount;

    // 查找房号链接（可点击的）
    document.querySelectorAll('a').forEach((a, i) => {
      const text = (a.innerText || '').trim();
      const href = a.href || '';
      if (text && (text.includes('801') || text.includes('101') || /^\d{3}[A-Z]?$/.test(text))) {
        result.roomLinks.push({
          type: 'link',
          text: text.substring(0, 50),
          href: href.substring(0, 200),
        });
      }
    });

    // 查找 class 包含 room/unit 的 div
    document.querySelectorAll('div[class*="room"], div[class*="unit"], div[class*="floor"], td[class*="room"], td[class*="unit"]').forEach((d, i) => {
      if (result.roomDivs.length < 30) {
        result.roomDivs.push({
          tag: d.tagName,
          class: d.className,
          text: (d.innerText || '').substring(0, 50),
        });
      }
    });

    // 查找楼盘表相关容器
    document.querySelectorAll('[class*="lpb"], [class*="楼盘"], [id*="lpb"], [id*="building"]').forEach((d, i) => {
      if (result.lpbContainers.length < 20) {
        result.lpbContainers.push({
          tag: d.tagName,
          id: d.id || '',
          class: d.className || '',
          text: (d.innerText || '').substring(0, 50),
        });
      }
    });

    return result;
  });

  console.log('\n=== 页面结构分析结果 ===');
  console.log(JSON.stringify(analysis, null, 2));

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'page_analysis.json'),
    JSON.stringify(analysis, null, 2),
    'utf-8'
  );

  // 另外：直接检查 HTML 中是否有 "已签约" 附近的 HTML（看颜色是如何渲染的）
  console.log('\n[6] 搜索 HTML 中的关键模式...');
  const htmlStr = fullHTML;
  
  // 找"已签约"附近的 HTML
  const signedIdx = htmlStr.indexOf('已签约');
  if (signedIdx > -1) {
    console.log('  "已签约" 出现在 HTML 中！上下文:');
    console.log(htmlStr.substring(Math.max(0, signedIdx - 300), signedIdx + 500));
  } else {
    console.log('  "已签约" 不在 HTML 中（可能是 JS 动态生成的）');
  }

  // 检查 table index=16 的完整 HTML（楼层房号表）
  console.log('\n[7] 提取楼层房号表的完整 HTML...');
  const tableHTML = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    if (tables.length >= 17) {
      return tables[16].outerHTML.substring(0, 5000);
    }
    return 'table[16] not found, total tables: ' + tables.length;
  });
  console.log(tableHTML.substring(0, 2000));
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'table16.html'),
    tableHTML,
    'utf-8'
  );

  await browser.close();
  console.log('\n=== 测试完成 ===');
  console.log('输出目录:', OUTPUT_DIR);
}

main().catch(console.error);
