/**
 * 北京住建委网签数据爬虫 v2 — 深入抓取楼盘详情和网签数据
 * 
 * 发现的关键页面:
 * - 列表页: pageId=307670 (项目信息公示) → 9024条记录
 * - 详情页: pageId=320794&projectID=XXXXXXX&systemID=2&srcId=1
 * - 期房网签: pageId=307690
 * - 现房网签: pageId=307694
 * - 存量房网签: pageId=307710
 * - 新建商品房房屋检索: pageId=307670 的表单中有搜索功能
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output_v2');
const BASE_URL = 'http://bjjs.zjw.beijing.gov.cn';

// 从第一轮爬虫中抓到的真实项目数据
const SAMPLE_PROJECTS = [
  { name: '铂瑞府', projectID: '8207359', certNo: '京房售证字(2026)42号', date: '2026-05-23' },
  { name: '金阙华院', projectID: '8205387', certNo: '京房售证字(2026)41号', date: '2026-05-16' },
  { name: '满和苑', projectID: '8203797', certNo: '京房售证字(2026)40号', date: '2026-05-10' },
];

const capturedAPI = [];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function captureAllResponses(page) {
  page.on('response', async (response) => {
    const url = response.url();
    const status = response.status();
    const ct = response.headers()['content-type'] || '';

    // 捕获所有包含疑似数据的响应
    if (ct.includes('json') || ct.includes('html') || ct.includes('text') ||
        url.includes('.do') || url.includes('.action') || url.includes('query') ||
        url.includes('search') || url.includes('sign') || url.includes('house') ||
        url.includes('project') || url.includes('eportal')) {
      try {
        const text = await response.text();
        capturedAPI.push({
          url,
          status,
          contentType: ct,
          size: text.length,
          preview: text.substring(0, 3000),
          timestamp: new Date().toISOString(),
        });
      } catch (e) {}
    }
  });
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('=== 网签数据爬虫 v2 — 深入详情页 ===\n');

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

  // 开启响应拦截
  await page.setRequestInterception(true);
  page.on('request', req => req.continue());
  
  // 捕获所有响应
  page.on('response', async (response) => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (ct.includes('json') || url.includes('query') || url.includes('search') ||
        url.includes('sign') || url.includes('house') || url.includes('project') ||
        url.includes('.do') || url.includes('.action')) {
      try {
        const text = await response.text();
        if (text.length > 10) {
          capturedAPI.push({
            url: url.substring(0, 200),
            status: response.status(),
            contentType: ct.substring(0, 80),
            size: text.length,
            preview: text.substring(0, 5000),
          });
        }
      } catch (e) {}
    }
  });

  // ======== 阶段1: 抓取项目详情页 ========
  console.log('--- 阶段1: 抓取楼盘详情页 ---');
  
  for (const project of SAMPLE_PROJECTS) {
    const detailUrl = `${BASE_URL}/eportal/ui?pageId=320794&projectID=${project.projectID}&systemID=2&srcId=1`;
    
    console.log(`\n访问: ${project.name} (${project.certNo})`);
    console.log(`  地址: ${detailUrl}`);
    
    try {
      await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(3000);

      // 截图
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `detail_${project.projectID}_${project.name}.png`),
        fullPage: true,
      });

      // 提取关键信息
      const detailData = await page.evaluate(() => {
        const result = { tables: [], textContent: [] };

        // 所有表格
        document.querySelectorAll('table').forEach((table, idx) => {
          const rows = [];
          table.querySelectorAll('tr').forEach(row => {
            const cells = [];
            row.querySelectorAll('td, th').forEach(cell => {
              cells.push(cell.innerText?.trim() || '');
            });
            if (cells.length > 0) rows.push(cells);
          });

          if (rows.length > 0) {
            result.tables.push({
              index: idx,
              rows: rows.slice(0, 50), // 最多50行
            });
          }
        });

        // 查找包含"网签"或"签约"文字的元素
        const signElements = [];
        const allElements = document.querySelectorAll('td, th, div, span, p');
        allElements.forEach(el => {
          const text = el.innerText?.trim() || '';
          if (text && (text.includes('网签') || text.includes('签约') || 
              text.includes('销售') || text.includes('已售') || 
              text.includes('未售') || text.includes('认购'))) {
            signElements.push({
              tag: el.tagName,
              text: text.substring(0, 200),
            });
          }
        });
        result.signElements = signElements.slice(0, 30);

        // 页面标题
        result.title = document.title;
        
        // body 全部文本（用于搜索关键词）
        result.bodyText = (document.body?.innerText || '').substring(0, 5000);

        return result;
      });

      // 保存提取的数据
      fs.writeFileSync(
        path.join(OUTPUT_DIR, `detail_${project.projectID}_${project.name}.json`),
        JSON.stringify(detailData, null, 2),
        'utf-8'
      );

      console.log(`  标题: ${detailData.title}`);
      console.log(`  表格数: ${detailData.tables.length}`);
      
      // 打印表格摘要
      detailData.tables.forEach((t, ti) => {
        if (t.rows.length > 0) {
          const headers = t.rows[0];
          console.log(`  表格${ti}: ${t.rows.length}行, 表头: [${headers.join(' | ').substring(0, 100)}]`);
        }
      });

      if (detailData.signElements.length > 0) {
        console.log(`  发现网签相关元素 (${detailData.signElements.length}个):`);
        detailData.signElements.slice(0, 10).forEach(el => {
          console.log(`    [${el.tag}] ${el.text.substring(0, 80)}`);
        });
      }

      console.log(`  截图已保存`);

    } catch (err) {
      console.log(`  访问失败: ${err.message}`);
    }
  }

  // ======== 阶段2: 尝试提交搜索表单 ========
  console.log('\n\n--- 阶段2: 尝试搜索接口 ---');

  try {
    // 回到列表页
    await page.goto(`${BASE_URL}/eportal/ui?pageId=307670&isTrue=0`, { 
      waitUntil: 'networkidle2', timeout: 60000 
    });
    await sleep(2000);

    // 尝试通过表单提交获取更多数据
    console.log('尝试提交搜索表单...');
    
    // 方法是：找到表单元素并提交
    const formSubmitResult = await page.evaluate(() => {
      const forms = document.querySelectorAll('form');
      const result = { formsFound: forms.length, forms: [] };
      
      forms.forEach((form, idx) => {
        result.forms.push({
          index: idx,
          action: form.action,
          method: form.method,
          id: form.id,
          name: form.name,
        });
      });
      return result;
    });

    console.log(`发现 ${formSubmitResult.formsFound} 个表单`);
    formSubmitResult.forms.forEach(f => {
      console.log(`  表单${f.index}: ${f.method || 'GET'} ${f.action} (id:${f.id})`);
    });

  } catch (err) {
    console.log(`搜索表单分析失败: ${err.message}`);
  }

  // ======== 阶段3: 尝试访问期房网签页面 ========
  console.log('\n\n--- 阶段3: 访问网签查询页面 ---');

  const signPages = [
    { name: '期房网签', url: `${BASE_URL}/eportal/ui?pageId=307690` },
    { name: '现房网签', url: `${BASE_URL}/eportal/ui?pageId=307694` },
    { name: '存量房网签', url: `${BASE_URL}/eportal/ui?pageId=307710` },
  ];

  for (const sp of signPages) {
    console.log(`\n访问: ${sp.name} → ${sp.url}`);
    try {
      await page.goto(sp.url, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(3000);

      await page.screenshot({
        path: path.join(OUTPUT_DIR, `sign_${sp.name}.png`),
        fullPage: true,
      });

      // 提取页面结构
      const pageInfo = await page.evaluate(() => {
        return {
          title: document.title,
          bodyText: (document.body?.innerText || '').substring(0, 3000),
          inputCount: document.querySelectorAll('input').length,
          formCount: document.querySelectorAll('form').length,
          selectCount: document.querySelectorAll('select').length,
        };
      });

      console.log(`  标题: ${pageInfo.title}`);
      console.log(`  表单数: ${pageInfo.formCount}, 输入框: ${pageInfo.inputCount}, 下拉: ${pageInfo.selectCount}`);
      console.log(`  截图已保存`);

      // 保存 bodyText
      fs.writeFileSync(
        path.join(OUTPUT_DIR, `sign_${sp.name}_text.txt`),
        pageInfo.bodyText,
        'utf-8'
      );

    } catch (err) {
      console.log(`  访问失败: ${err.message}`);
    }
  }

  // ======== 汇总捕获的 API 数据 ========
  console.log('\n\n=== 捕获的API数据汇总 ===');
  console.log(`总计捕获 ${capturedAPI.length} 条响应`);

  const jsonResponses = capturedAPI.filter(r => r.contentType.includes('json'));
  const htmlResponses = capturedAPI.filter(r => r.contentType.includes('html'));
  console.log(`  JSON响应: ${jsonResponses.length} 条`);
  console.log(`  HTML响应: ${htmlResponses.length} 条`);

  // 保存所有捕获的数据
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'all_captured_api.json'),
    JSON.stringify(capturedAPI.map(r => ({
      url: r.url,
      status: r.status,
      contentType: r.contentType,
      size: r.size,
      preview: r.preview,
    })), null, 2),
    'utf-8'
  );

  // 单独保存 JSON 响应
  jsonResponses.forEach((r, i) => {
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `api_json_${i + 1}.json`),
      r.preview,
      'utf-8'
    );
  });

  await browser.close();
  console.log('\n=== 爬虫 v2 执行完毕 ===');
  console.log(`输出目录: ${OUTPUT_DIR}`);
}

main().catch(console.error);
