import { chromium } from 'playwright-core';
const base = 'https://rohit-ats.github.io/Rescue-Relay';
const routes = ['/', '/dashboard', '/memberships', '/workflows', '/auth'];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
for (const r of routes) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 300)); });
  page.on('requestfailed', req => errs.push('REQFAIL: ' + req.url().slice(0, 120) + ' :: ' + req.failure()?.errorText));
  try {
    await page.goto(base + r, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);
  } catch (e) { errs.push('NAV: ' + e.message.slice(0, 150)); }
  const broke = await page.locator("text=This page didn't load").count();
  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 120).replace(/\n/g, ' | ');
  console.log(`\n=== ${r} === brokenPage=${broke}`);
  console.log('  body:', body);
  [...new Set(errs)].slice(0, 6).forEach(e => console.log('  ' + e));
  await page.close();
}
await browser.close();
