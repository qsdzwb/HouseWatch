const puppeteer = require('puppeteer');
const config = require('../config');

let browser = null;

async function getBrowser() {
  if (browser && browser.connected) {
    return browser;
  }

  const launchOpts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  };

  if (config.crawl.chromePath) {
    launchOpts.executablePath = config.crawl.chromePath;
  }

  browser = await puppeteer.launch(launchOpts);
  return browser;
}

async function newPage() {
  const b = await getBrowser();
  const page = await b.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });
  return page;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

module.exports = { getBrowser, newPage, closeBrowser };
