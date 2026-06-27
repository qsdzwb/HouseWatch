const http = require('http');
const config = require('../config');

/**
 * 辅助：延迟
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 纯 HTTP 获取房屋详情页 HTML
 * 
 * 房屋详情页 (pageId=373432) 是 portal 框架页面，
 * 纯 HTTP 请求即可获取完整 HTML，无需 Chrome/Puppeteer。
 */
function fetchHtml(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const doFetch = (attempt) => {
      const parsed = new URL(url);
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Connection': 'keep-alive',
        },
        timeout: 30000,
      };

      const req = http.request(options, (res) => {
        // 处理重定向
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            // 递归跟随重定向
            fetchHtml(redirectUrl.startsWith('http') ? redirectUrl : `http://${parsed.hostname}${redirectUrl}`, 0)
              .then(resolve)
              .catch(reject);
            return;
          }
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          if (body.length < 1000 && attempt < retries) {
            // 响应体太小（可能是空框架），重试
            console.log(`    [Layer 4] 响应太小 (${body.length} bytes)，重试 ${attempt + 1}/${retries}...`);
            setTimeout(() => doFetch(attempt + 1), 2000);
          } else {
            resolve(body);
          }
        });
      });

      req.on('error', (err) => {
        if (attempt < retries) {
          console.log(`    [Layer 4] 请求失败: ${err.message}，重试 ${attempt + 1}/${retries}...`);
          setTimeout(() => doFetch(attempt + 1), 2000);
        } else {
          reject(err);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        if (attempt < retries) {
          console.log(`    [Layer 4] 请求超时，重试 ${attempt + 1}/${retries}...`);
          setTimeout(() => doFetch(attempt + 1), 2000);
        } else {
          reject(new Error('请求超时'));
        }
      });

      req.end();
    };

    doFetch(0);
  });
}

/**
 * 从 HTML 中提取房屋资料
 * 
 * 房屋详情页的表格结构（纯 HTML，无需 JS 渲染）：
 * <table>
 *   <tr><td>房 间 号</td><td>一单元-801</td></tr>
 *   <tr><td>规划设计用途</td><td>住宅</td></tr>
 *   <tr><td>户　　型</td><td>三室两厅</td></tr>
 *   <tr><td>建筑面积</td><td>80.8400 平方米</td></tr>
 *   <tr><td>套内面积</td><td>65.2400 平方米</td></tr>
 *   <tr><td>按建筑面积拟售单价</td><td>67586.63 元/平方米</td></tr>
 *   <tr><td>按套内面积拟售单价</td><td>83747.75 元/平方米</td></tr>
 * </table>
 */
function extractDetailFromHtml(html) {
  const result = {
    roomNo: '',
    purpose: '',
    layout: '',
    buildArea: '',
    innerArea: '',
    pricePerSqM: '',
    pricePerSqMInner: '',
  };

  // 去除所有空白（包括全角空格 \u3000、不间断空格 \u00A0）统一比较
  const stripWhitespace = (s) => s.replace(/[\s\u3000\u00A0]+/g, '');

  // 正则匹配每个 <tr> 中的两个 <td>：标签和值
  // <td[^>]*>标签内容</td>\s*<td[^>]*>值内容</td>
  const rowRegex = /<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const rawLabel = match[1].replace(/<[^>]+>/g, '').trim();
    const rawValue = match[2].replace(/<[^>]+>/g, '').trim();
    const label = stripWhitespace(rawLabel);
    const value = rawValue;

    if (!value) continue;

    if (label.includes('房间号')) {
      result.roomNo = value;
    } else if (label.includes('规划设计用途') || (label.includes('用途') && !label.includes('房间') && !label.includes('面积'))) {
      if (!result.purpose) result.purpose = value;
    } else if (label.includes('户型')) {
      result.layout = value;
    } else if (label.includes('建筑面积') && !label.includes('套内') && !label.includes('拟售')) {
      result.buildArea = value;
    } else if (label.includes('套内面积') && !label.includes('拟售')) {
      result.innerArea = value;
    } else if (label.includes('建筑面积拟售单价')) {
      result.pricePerSqM = value;
    } else if (label.includes('套内面积拟售单价')) {
      result.pricePerSqMInner = value;
    }
  }

  return result;
}

/**
 * Layer 4: 房屋详情爬虫 — 提取面积、户型、拟售单价
 * 
 * 使用纯 HTTP 请求访问 pageId=373432&houseId=<ID>，
 * 从房屋资料表格中解析 7 个关键字段。
 * 
 * 注意：portal 框架的房屋详情页纯 HTTP 即可获取完整数据，
 * 不需要 Chrome/Puppeteer。这是整个住建委网站的统一特性。
 */
async function crawlHouseDetail(houseId, salePermitId, houseNo = '') {
  // 构建 URL — houseNo 参数虽然不必须但有助于定位
  const encodedHouseNo = houseNo ? `&houseNo=${encodeURIComponent(houseNo)}` : '';
  const url = `${config.crawl.pageUrl}?pageId=373432&houseId=${houseId}${encodedHouseNo}&categoryId=1&salePermitId=${salePermitId}&systemId=2`;

  try {
    console.log(`    [Layer 4] 开始抓取房屋详情 (houseId=${houseId})`);
    console.log(`    [Layer 4] URL: ${url}`);

    const html = await fetchHtml(url, 3);

    console.log(`    [Layer 4] HTTP 响应长度: ${html.length} bytes`);

    // 提取数据
    const detail = extractDetailFromHtml(html);

    console.log(`    [Layer 4] 提取结果 (houseId=${houseId}):`, JSON.stringify(detail));

    // 检查是否有有效数据
    const hasData = detail.purpose || detail.layout || detail.buildArea;
    if (!hasData) {
      console.log(`    [Layer 4] ⚠️ 未提取到数据，HTML 中可能不含房屋资料表格 (houseId=${houseId})`);
      // 只在前 200 字符内找线索
      const idx = html.indexOf('房屋资料');
      if (idx < 0) {
        console.log(`    [Layer 4] HTML 中未找到"房屋资料"关键字`);
      }
    }

    return detail;
  } catch (err) {
    console.error(`    [Layer 4] 房屋详情抓取失败 (houseId=${houseId}): ${err.message}`);
    return null;
  }
}

module.exports = { crawlHouseDetail };
