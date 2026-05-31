const puppeteer = require('puppeteer');
const fs = require('fs');

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  console.log('访问列表页...');
  await page.goto('http://bjjs.zjw.beijing.gov.cn/eportal/ui?pageId=307670', 
    { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(function(){});
  await new Promise(function(r){setTimeout(r,10000);});
  
  // 1. 检查 iframes
  var iframes = await page.evaluate(function() {
    return Array.from(document.querySelectorAll('iframe')).map(function(f) {
      return { id: f.id, name: f.name, src: (f.src||'').substring(0,300), className: f.className };
    });
  });
  console.log('\n=== iframes ===');
  console.log(JSON.stringify(iframes, null, 2));
  
  // 2. 检查主 HTML 中的表格（翻页前的）
  var tables = await page.evaluate(function() {
    return Array.from(document.querySelectorAll('table')).map(function(t, i) {
      var rows = t.querySelectorAll('tr');
      var headers = [];
      var firstData = [];
      if (rows.length > 0) {
        headers = Array.from(rows[0].querySelectorAll('td,th')).map(function(c){return c.innerText.trim();});
      }
      if (rows.length > 1) {
        firstData = Array.from(rows[1].querySelectorAll('td')).map(function(c){return c.innerText.trim();});
      }
      return { idx: i, rows: rows.length, headers: headers.slice(0,10), firstData: firstData.slice(0,10) };
    }).filter(function(t){return t.rows > 0;});
  });
  console.log('\n=== 主页面表格 ===');
  console.log(JSON.stringify(tables, null, 2));
  
  // 3. 检查所有 iframe 的 HTML（看是否数据在 iframe 里）
  var frames = page.frames();
  console.log('\n=== frames 数量: ' + frames.length + ' ===');
  for (var i = 1; i < frames.length; i++) {
    try {
      var url = frames[i].url();
      console.log('Frame ' + i + ': ' + url.substring(0,200));
      
      // 检查这个 frame 里的表格
      var ftables = await frames[i].evaluate(function() {
        return Array.from(document.querySelectorAll('table')).map(function(t, j) {
          var rows = t.querySelectorAll('tr');
          var headers = [];
          if (rows.length > 0) {
            headers = Array.from(rows[0].querySelectorAll('td,th')).map(function(c){return c.innerText.trim();});
          }
          return { rows: rows.length, headers: headers.slice(0,8) };
        }).filter(function(t){return t.rows > 0;});
      });
      if (ftables.length > 0) {
        console.log('  tables: ' + JSON.stringify(ftables));
      }
      
      // 获取 iframe 内完整 HTML 片段（前2000字符）
      var html = await frames[i].evaluate(function() {
        return (document.body ? document.body.innerHTML : document.documentElement.innerHTML).substring(0, 2000);
      });
      fs.writeFileSync('/tmp/frame_' + i + '.html', html);
    } catch(e) {
      console.log('Frame ' + i + ' error: ' + e.message);
    }
  }
  
  // 4. 保存主页面 HTML
  var mainHtml = await page.content();
  fs.writeFileSync('/tmp/main_page.html', mainHtml);
  console.log('\n主页面 HTML 已保存: ' + mainHtml.length + ' 字节');
  
  // 5. 搜索 HTML 中的 projectID 链接
  var projectLinks = mainHtml.match(/projectID=\d+/g) || [];
  console.log('HTML 中 projectID 链接数: ' + projectLinks.length);
  
  await browser.close();
}
main().catch(console.error);
