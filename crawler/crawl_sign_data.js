/**
 * 北京住建委网签数据爬虫 — 验证抓取可行性
 * 
 * 目标页面: http://bjjs.zjw.beijing.gov.cn/eportal/ui?pageId=307670&isTrue=0
 * 
 * 策略:
 * 1. Puppeteer 无头浏览器完整加载页面
 * 2. 拦截所有网络请求，捕获真实 API 接口和数据
 * 3. 截图保存页面渲染结果
 * 4. 提取 DOM 中的关键数据
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output');
const TARGET_URL = 'http://bjjs.zjw.beijing.gov.cn/eportal/ui?pageId=307670&isTrue=0';

// 存储拦截到的 API 响应
const capturedResponses = [];
const capturedXHR = [];

async function main() {
  // 确保输出目录存在
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('=== 北京住建委网签数据爬虫 ===');
  console.log(`目标页面: ${TARGET_URL}`);
  console.log('启动浏览器...\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  const page = await browser.newPage();

  // 设置 User-Agent（模拟普通浏览器）
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  // 设置视口
  await page.setViewport({ width: 1920, height: 1080 });

  // ---- 拦截网络请求 ----
  await page.setRequestInterception(true);

  page.on('request', (request) => {
    const url = request.url();
    const resourceType = request.resourceType();

    // 记录 XHR/Fetch 请求
    if (resourceType === 'xhr' || resourceType === 'fetch') {
      capturedXHR.push({
        url,
        method: request.method(),
        postData: request.postData(),
        timestamp: new Date().toISOString(),
      });
    }

    // 允许所有请求
    request.continue();
  });

  page.on('response', async (response) => {
    const url = response.url();
    const status = response.status();
    const contentType = response.headers()['content-type'] || '';

    // 只关注 JSON 或 HTML 响应
    if (contentType.includes('json') || contentType.includes('html') || 
        url.includes('queryNewHouse') || url.includes('signInfo') ||
        url.includes('querySign') || url.includes('houseSign') ||
        url.includes('getProject') || url.includes('realtor') ||
        url.includes('.do') || url.includes('.action')) {
      
      try {
        const text = await response.text();
        capturedResponses.push({
          url,
          status,
          contentType,
          bodyLength: text.length,
          bodyPreview: text.substring(0, 2000),
          fullBody: text,
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        capturedResponses.push({
          url,
          status,
          contentType,
          error: e.message,
        });
      }
    }
  });

  // ---- 打印控制台日志 ----
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log(`  [浏览器错误] ${msg.text()}`);
    }
  });

  try {
    console.log('正在访问目标页面...');
    await page.goto(TARGET_URL, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    console.log('页面加载完成，等待动态内容渲染...');
    
    // 额外等待，确保异步数据加载完成
    await new Promise(r => setTimeout(r, 5000));

    // ---- 截图 ----
    console.log('正在截图...');
    await page.screenshot({
      path: path.join(OUTPUT_DIR, 'page_screenshot.png'),
      fullPage: true,
    });
    console.log('  截图已保存: page_screenshot.png');

    // ---- 保存页面 HTML ----
    console.log('正在提取页面内容...');
    const htmlContent = await page.content();
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'page_source.html'),
      htmlContent,
      'utf-8'
    );
    console.log(`  页面HTML已保存: page_source.html (${(htmlContent.length / 1024).toFixed(1)} KB)`);

    // ---- 提取关键 DOM 信息 ----
    const domInfo = await page.evaluate(() => {
      const result = {
        title: document.title,
        url: document.location.href,
        bodyTextLength: document.body?.innerText?.length || 0,
        tables: [],
        iframes: [],
        scripts: [],
      };

      // 收集所有表格
      document.querySelectorAll('table').forEach((table, idx) => {
        const rowCount = table.querySelectorAll('tr').length;
        const headerText = [];
        table.querySelectorAll('th').forEach(th => headerText.push(th.innerText.trim()));
        
        // 取前5行数据作为样本
        const sampleRows = [];
        table.querySelectorAll('tr').forEach((row, ri) => {
          if (ri < 5) {
            const cells = [];
            row.querySelectorAll('td, th').forEach(cell => cells.push(cell.innerText.trim()));
            sampleRows.push(cells);
          }
        });

        result.tables.push({
          index: idx,
          rows: rowCount,
          headers: headerText.slice(0, 10),
          sampleRows,
        });
      });

      // 收集 iframe
      document.querySelectorAll('iframe').forEach((iframe, idx) => {
        result.iframes.push({
          index: idx,
          src: iframe.src,
          id: iframe.id,
          name: iframe.name,
        });
      });

      // 关键：尝试从页面 JS 变量中提取数据
      // 一些政府网站把数据存在 window 对象上
      const windowKeys = [];
      try {
        for (const key of Object.keys(window)) {
          if (key.toLowerCase().includes('data') || 
              key.toLowerCase().includes('sign') ||
              key.toLowerCase().includes('house') ||
              key.toLowerCase().includes('project') ||
              key.toLowerCase().includes('config')) {
            windowKeys.push(key);
          }
        }
      } catch (e) {}

      // 搜索页面中可能的链接
      const links = [];
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.href || '';
        if (href.includes('pageId') || href.includes('query') || href.includes('sign')) {
          links.push({
            text: a.innerText.trim().substring(0, 50),
            href: href.substring(0, 200),
          });
        }
      });

      result.windowDataKeys = windowKeys.slice(0, 20);
      result.relevantLinks = links.slice(0, 20);

      // 查找包含关键字的元素
      const keywordElements = [];
      const keywords = ['网签', '签约', '项目', '楼盘', '房源', '商品房', '预售'];
      keywords.forEach(kw => {
        const els = document.querySelectorAll(`[class*="${kw}"], [id*="${kw}"]`);
        els.forEach(el => {
          keywordElements.push({
            keyword: kw,
            tag: el.tagName,
            text: el.innerText?.trim()?.substring?.(0, 50) || '',
          });
        });
      });
      result.keywordElements = keywordElements.slice(0, 30);

      return result;
    });

    // ---- 保存 DOM 分析结果 ----
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'dom_analysis.json'),
      JSON.stringify(domInfo, null, 2),
      'utf-8'
    );
    console.log('  DOM分析已保存: dom_analysis.json');

    // ---- 分析捕获的数据 ----
    console.log('\n=== 捕获结果分析 ===');
    console.log(`拦截到的 XHR/Fetch 请求: ${capturedXHR.length} 个`);
    console.log(`拦截到的关键响应: ${capturedResponses.length} 个`);

    if (capturedXHR.length > 0) {
      console.log('\nXHR/Fetch 请求列表:');
      capturedXHR.forEach((xhr, i) => {
        console.log(`  [${i + 1}] ${xhr.method} ${xhr.url}`);
      });
    }

    if (capturedResponses.length > 0) {
      console.log('\n关键响应列表:');
      capturedResponses.forEach((resp, i) => {
        console.log(`  [${i + 1}] ${resp.status} | ${resp.contentType.substring(0, 50)} | ${resp.bodyLength} bytes → ${resp.url.substring(0, 100)}`);
      });

      // 将响应数据保存到文件
      fs.writeFileSync(
        path.join(OUTPUT_DIR, 'captured_responses.json'),
        JSON.stringify(capturedResponses.map(r => ({
          url: r.url,
          status: r.status,
          contentType: r.contentType,
          bodyLength: r.bodyLength,
          bodyPreview: r.bodyPreview,
        })), null, 2),
        'utf-8'
      );

      // 单独保存每个 JSON 响应
      capturedResponses.forEach((resp, i) => {
        if (resp.contentType.includes('json')) {
          fs.writeFileSync(
            path.join(OUTPUT_DIR, `api_response_${i + 1}.json`),
            resp.fullBody,
            'utf-8'
          );
        }
      });
      console.log('  完整响应已保存到 output/ 目录');
    }

    // ---- 打印页面基本信息 ----
    console.log('\n=== 页面基本信息 ===');
    console.log(`标题: ${domInfo.title}`);
    console.log(`当前URL: ${domInfo.url}`);
    console.log(`页面文本长度: ${domInfo.bodyTextLength} 字符`);
    console.log(`表格数量: ${domInfo.tables.length}`);
    console.log(`iframe数量: ${domInfo.iframes.length}`);

    if (domInfo.iframes.length > 0) {
      console.log('\niframe列表:');
      domInfo.iframes.forEach(f => {
        console.log(`  src: ${f.src}`);
      });
    }

    if (domInfo.tables.length > 0) {
      console.log('\n表格样本数据:');
      domInfo.tables.forEach(t => {
        if (t.headers.length > 0) {
          console.log(`  表头: [${t.headers.join(' | ')}]`);
        }
        if (t.sampleRows.length > 1) {
          console.log(`  第1行数据: [${t.sampleRows[1]?.join(' | ') || ''}]`);
        }
      });
    }

    if (domInfo.windowDataKeys.length > 0) {
      console.log('\n页面window对象上的数据相关key:');
      console.log(`  ${domInfo.windowDataKeys.join(', ')}`);
    }

    if (domInfo.relevantLinks.length > 0) {
      console.log('\n相关链接:');
      domInfo.relevantLinks.forEach(l => {
        console.log(`  ${l.text} → ${l.href}`);
      });
    }

    console.log('\n=== 爬虫执行完毕 ===');
    console.log('输出文件位于: ' + OUTPUT_DIR);

  } catch (error) {
    console.error('\n爬虫出错:', error.message);
    
    // 即使出错也尝试截图
    try {
      await page.screenshot({
        path: path.join(OUTPUT_DIR, 'error_screenshot.png'),
        fullPage: true,
      });
      console.log('已保存错误状态截图');
    } catch (e) {}
  } finally {
    await browser.close();
    console.log('浏览器已关闭');
  }
}

main().catch(console.error);
