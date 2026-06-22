const { newPage } = require('./browser');
const config = require('../config');
const fs = require('fs');
const path = require('path');

/**
 * 辅助：延迟
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 从页面或 iframe 中提取房屋详情
 */
async function extractDetailFromPage(pageOrFrame) {
  return await pageOrFrame.evaluate(() => {
    const result = {
      roomNo: '',
      purpose: '',
      layout: '',
      buildArea: '',
      innerArea: '',
      pricePerSqM: '',
      pricePerSqMInner: '',
    };

    // 方法1：从表格中提取（精确匹配标签，支持全角空格）
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          // 移除所有空白字符（包括全角空格）进行比较
          const label = (cells[0]?.innerText || '').replace(/[\s\u00A0\u3000]+/g, ' ').trim();
          const value = (cells[1]?.innerText || '').replace(/[\s\u00A0\u3000]+/g, ' ').trim();

          if (label.includes('房间号'))
            result.roomNo = value;
          if (label.includes('用途'))
            result.purpose = value;
          if (label.includes('户型'))
            result.layout = value;
          if (label.includes('建筑面积') && !label.includes('套内') && !label.includes('拟售'))
            result.buildArea = value;
          if (label.includes('套内面积') && !label.includes('拟售'))
            result.innerArea = value;
          if (label.includes('建筑面积拟售单价'))
            result.pricePerSqM = value;
          if (label.includes('套内面积拟售单价'))
            result.pricePerSqMInner = value;
        }
      }
    }

    // 方法2：正则从页面文本提取（备用）
    const allText = document.body?.innerText || '';
    
    if (!result.purpose) {
      const match = allText.match(/用途[：:\s]*(\S+)/);
      if (match) result.purpose = match[1];
    }
    
    if (!result.layout) {
      const match = allText.match(/户[\s\u3000]*型[：:\s]*([^\n]+)/);
      if (match) result.layout = match[1].trim();
    }
    
    if (!result.buildArea) {
      const match = allText.match(/建筑面积[：:\s]*([\d.]+)/);
      if (match) result.buildArea = match[1];
    }
    
    if (!result.innerArea) {
      const match = allText.match(/套内面积[：:\s]*([\d.]+)/);
      if (match) result.innerArea = match[1];
    }

    return result;
  });
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

  // 收集所有网络请求
  const capturedRequests = [];
  
  try {
    console.log(`    [Layer 4] 开始抓取房屋详情 (houseId=${houseId})`);
    console.log(`    [Layer 4] URL: ${url}`);
    
    // 启用请求拦截
    await page.setRequestInterception(true);
    
    page.on('request', (req) => {
      const reqUrl = req.url();
      capturedRequests.push({
        url: reqUrl,
        method: req.method(),
        resourceType: req.resourceType(),
        postData: req.postData()
      });
      req.continue();
    });

    page.on('response', async (res) => {
      const resUrl = res.url();
      try {
        const contentType = res.headers()['content-type'] || '';
        if (contentType.includes('json') || contentType.includes('text') || contentType.includes('html')) {
          const text = await res.text();
          if (text.length < 50000 && (text.includes('用途') || text.includes('户型') || text.includes('建筑面积') || text.includes('房间号'))) {
            console.log(`    [Layer 4] 🎯 发现可能包含数据的响应:`);
            console.log(`    [Layer 4] URL: ${resUrl.substring(0, 200)}`);
            console.log(`    [Layer 4] Content-Type: ${contentType}`);
            console.log(`    [Layer 4] 内容预览: ${text.substring(0, 500)}`);
          }
        }
      } catch (e) {
        // 忽略响应读取错误
      }
    });
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // 等待更长时间，确保 JS 完全渲染
    await sleep(10000);
    
    // 尝试等待可能的加载指示器消失（如果存在）
    try {
      await page.waitForSelector('.loading', { hidden: true, timeout: 5000 });
    } catch (e) {
      // 没有 loading 指示器也没关系
    }
    
    // 尝试等待数据表格出现
    try {
      await page.waitForSelector('table', { timeout: 5000 });
      console.log(`    [Layer 4] 检测到表格元素`);
    } catch (e) {
      console.log(`    [Layer 4] 未检测到表格元素，继续尝试提取...`);
    }

    // 尝试从主页面提取
    let detail = await extractDetailFromPage(page);
    
    // 检查是否获取到有效数据
    const hasData = detail.purpose || detail.layout || detail.buildArea;
    
    if (!hasData) {
      console.log(`    [Layer 4] 主页面未获取到数据，尝试从 iframe 提取...`);
      
      // 尝试从 iframe 中获取内容
      const frames = page.frames();
      console.log(`    [Layer 4] 发现 ${frames.length} 个 iframe`);
      
      for (const frame of frames) {
        try {
          const frameText = await frame.evaluate(() => document.body?.innerText || '');
          if (frameText.length > 100) {
            console.log(`    [Layer 4] 从 iframe (${frame.url()}) 提取数据...`);
            const iframeDetail = await extractDetailFromPage(frame);
            if (iframeDetail.purpose || iframeDetail.layout || iframeDetail.buildArea) {
              detail = iframeDetail;
              break;
            }
          }
        } catch (e) {
          // iframe 可能跨域，忽略错误
          console.log(`    [Layer 4] iframe 访问失败: ${e.message}`);
        }
      }
    }

    // 调试：输出提取结果
    console.log(`    [Layer 4] 提取结果 (houseId=${houseId}):`, JSON.stringify(detail));
    
    // 调试：输出所有捕获的网络请求
    console.log(`    [Layer 4] 📡 捕获的网络请求 (${capturedRequests.length}个):`);
    capturedRequests.forEach((req, i) => {
      if (req.resourceType === 'xhr' || req.resourceType === 'fetch' || req.url.includes('api') || req.url.includes('json') || req.url.includes('data')) {
        console.log(`    [Layer 4]   [${i}] ${req.method} ${req.url.substring(0, 150)}`);
      }
    });

    // 如果仍然没有数据，保存页面截图和HTML用于调试
    if (!detail.purpose && !detail.layout && !detail.buildArea) {
      const debugDir = path.join(__dirname, '../../logs');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      
      // 保存截图
      const screenshotFile = path.join(debugDir, `crawl_debug_${houseId}_${Date.now()}.png`);
      await page.screenshot({ path: screenshotFile, fullPage: true });
      console.log(`    [Layer 4] 页面截图已保存到: ${screenshotFile}`);
      
      // 保存HTML
      const htmlContent = await page.content();
      const debugFile = path.join(debugDir, `crawl_debug_${houseId}_${Date.now()}.html`);
      fs.writeFileSync(debugFile, htmlContent);
      console.log(`    [Layer 4] 页面HTML已保存到: ${debugFile}`);
    }

    return detail;
  } catch (err) {
    console.error(`    [Layer 4] 房屋详情抓取失败 (houseId=${houseId}): ${err.message}`);
    return null;
  } finally {
    await page.close();
  }
}

module.exports = { crawlHouseDetail };
