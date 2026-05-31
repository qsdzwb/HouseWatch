const puppeteer = require('puppeteer');
const fs = require('fs');

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  const allRequests = [];
  const allResponses = [];
  
  page.on('request', req => {
    const url = req.url();
    const type = req.resourceType();
    if (type !== 'stylesheet' && type !== 'image' && type !== 'font') {
      allRequests.push({ method: req.method(), url: url.substring(0,200), type });
    }
  });
  
  page.on('response', async res => {
    const url = res.url();
    const type = res.request().resourceType();
    if (type === 'xhr' || type === 'fetch') {
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('json')) {
          const json = await res.json();
          allResponses.push({ url: url.substring(0,200), data: JSON.stringify(json).substring(0,300) });
        }
      } catch(e) {}
    }
  });

  console.log('访问列表页...');
  await page.goto('http://bjjs.zjw.beijing.gov.cn/eportal/ui?pageId=307670', { waitUntil: 'networkidle0', timeout: 60000 }).catch(()=>{});
  await new Promise(r => setTimeout(r, 10000));
  
  console.log(`\n=== 非静态资源请求 (${allRequests.length} 个) ===`);
  allRequests.forEach(r => console.log(`  [${r.type}] ${r.method} ${r.url}`));
  
  console.log(`\n=== XHR/Fetch 响应 (${allResponses.length} 个) ===`);
  allResponses.forEach(r => console.log(`  URL: ${r.url}\n  数据: ${r.data}\n`));
  
  // 获取页面上所有 iframe 的 src
  const iframes = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('iframe')).map(f => ({ id: f.id, src: f.src?.substring(0,200) }));
  });
  console.log('\n=== iframes ===');
  console.log(JSON.stringify(iframes, null, 2));
  
  await browser.close();
}
main().catch(console.error);
