const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  console.log('访问列表页...');
  await page.goto('http://bjjs.zjw.beijing.gov.cn/eportal/ui?pageId=307670', 
    { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
  await new Promise(r => setTimeout(r, 10000));
  
  // 获取完整 HTML
  const html = await page.content();
  fs.writeFileSync('/tmp/page_full.html', html);
  console.log('HTML 已保存，大小:', html.length);
  
  // 查找 HTML 中所有 JSON 数据块
  const jsonMatches = html.match(/\{[^{}]*"projectID"[^{}]*\}/g) || [];
  console.log('\n含 projectID 的 JSON 片段:', jsonMatches.length);
  jsonMatches.slice(0,3).forEach(m => console.log(' ', m.substring(0,200)));
  
  // 查找 scripts 中的数据结构
  const scripts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script')).map(s => {
      const t = s.innerText || s.textContent || '';
      return t.length > 20 ? t.substring(0, 500) : '';
    }).filter(Boolean);
  });
  console.log('\n=== Script 内容（前3个）===');
  scripts.slice(0,3).forEach((s,i) => console.log(`\n[Script ${i}]\n`, s.substring(0,500)));
  
  // 看 bjjs.js 的内容（发起请求获取）
  const bjjsUrl = 'http://bjjs.zjw.beijing.gov.cn/eportal/fileDir/bjjs/template/bjjs.js';
  const bjjs = await page.evaluate(async (url) => {
    const r = await fetch(url);
    return r.text();
  }, bjjsUrl).catch(() => '');
  console.log('\nbjjs.js 大小:', bjjs.length);
  // 查找其中的 URL 模式
  const urlPatterns = bjjs.match(/https?:\/\/[^"'\s]+/g) || [];
  console.log('bjjs.js 中的 URL:', urlPatterns.slice(0,10));
  const apiPatterns = bjjs.match(/eportal\/[a-zA-Z0-9_\/]+/g) || [];
  console.log('eportal 路径:', [...new Set(apiPatterns)].slice(0,10));
  
  fs.writeFileSync('/tmp/bjjs_js.txt', bjjs);
  console.log('\nbjjs.js 已保存到 /tmp/bjjs_js.txt');
  
  await browser.close();
}
main().catch(console.error);
