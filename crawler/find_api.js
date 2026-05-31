const puppeteer = require('puppeteer');
const fs = require('fs');

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  const allReqs = [];
  page.on('request', req => {
    const url = req.url();
    const type = req.resourceType();
    if (!['stylesheet','image','font','media'].includes(type)) {
      const entry = { type: 'REQ', method: req.method(), url: url.substring(0,300) };
      const pd = req.postData();
      if (pd) entry.postData = pd.substring(0,200);
      allReqs.push(entry);
    }
  });
  
  page.on('response', async res => {
    const url = res.url();
    const type = res.request().resourceType();
    if (type === 'xhr' || type === 'fetch') {
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('json') || ct.includes('text')) {
          const text = await res.text().catch(function(){return '';});
          if (text && text.length > 10 && text.length < 50000) {
            allReqs.push({ type: 'RESP', url: url.substring(0,300), body: text.substring(0,500) });
          }
        }
      } catch(e) {}
    }
  });

  console.log('访问列表页...');
  await page.goto('http://bjjs.zjw.beijing.gov.cn/eportal/ui?pageId=307670', 
    { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(function(){});
  
  console.log('等待页面渲染（15秒）...');
  await new Promise(function(r){setTimeout(r,15000);});
  
  // 尝试点击下一页，捕获翻页请求
  console.log('尝试翻页...');
  await page.evaluate(function() {
    var links = document.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) {
      var t = (links[i].innerText||'').trim();
      if (t === '下一页' || t === '>') {
        links[i].click();
        return;
      }
    }
  }).catch(function(){});
  
  await new Promise(function(r){setTimeout(r,8000);});
  
  console.log('\n=== 共捕获 ' + allReqs.length + ' 个请求/响应 ===');
  for (var i = 0; i < allReqs.length; i++) {
    var r = allReqs[i];
    console.log('\n[' + (i+1) + '] ' + r.type + ': ' + (r.method||'') + ' ' + r.url);
    if (r.postData) console.log('  POST: ' + r.postData.substring(0,200));
    if (r.body) console.log('  RESP: ' + r.body.substring(0,300));
  }
  
  fs.writeFileSync('/tmp/api_capture.json', JSON.stringify(allReqs, null, 2));
  console.log('\n已保存到 /tmp/api_capture.json');
  
  await browser.close();
}
main().catch(console.error);
