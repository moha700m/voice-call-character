import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const target = process.env.VIBI_URL || 'https://vibi.pro/';
const outDir = 'artifacts/vibi-probe';
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'en-US',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
});
const page = await context.newPage();

const requests = [];
const responses = [];

page.on('request', req => {
  const u = req.url();
  requests.push({ method: req.method(), url: u, resourceType: req.resourceType() });
});
page.on('response', res => {
  const req = res.request();
  responses.push({ method: req.method(), url: res.url(), status: res.status(), resourceType: req.resourceType() });
});

let navigationError = null;
try {
  await page.goto(target, { waitUntil: 'networkidle', timeout: 60000 });
} catch (err) {
  navigationError = String(err?.message || err);
}

const title = await page.title().catch(() => '');
const url = page.url();
const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
const links = await page.locator('a').evaluateAll(els => els.slice(0, 300).map(a => ({ text: (a.textContent || '').trim().slice(0, 200), href: a.href })) ).catch(() => []);
const forms = await page.locator('form').evaluateAll(forms => forms.map(f => ({
  action: f.action,
  method: f.method,
  inputs: Array.from(f.querySelectorAll('input,select,textarea,button')).slice(0,100).map(el => ({
    tag: el.tagName,
    type: el.getAttribute('type'),
    name: el.getAttribute('name'),
    placeholder: el.getAttribute('placeholder'),
    text: (el.textContent || '').trim().slice(0,100)
  }))
}))).catch(() => []);
const scripts = await page.locator('script[src]').evaluateAll(els => els.map(s => s.src)).catch(() => []);

await page.screenshot({ path: `${outDir}/page.png`, fullPage: true }).catch(() => {});
await fs.writeFile(`${outDir}/page.html`, await page.content().catch(() => ''));

const interesting = [...responses]
  .filter(x => /vibi|api|auth|login|speech|tts|eleven|minimax|credit|gift|dashboard/i.test(x.url))
  .slice(0, 1000);

const report = {
  target,
  finalUrl: url,
  title,
  navigationError,
  bodyText: bodyText.slice(0, 30000),
  links,
  forms,
  scripts,
  interestingNetwork: interesting,
  allNetworkCount: responses.length,
  generatedAt: new Date().toISOString(),
};

await fs.writeFile(`${outDir}/report.json`, JSON.stringify(report, null, 2));
await fs.writeFile(`${outDir}/network.json`, JSON.stringify(responses.slice(0, 5000), null, 2));

console.log(JSON.stringify({ title, finalUrl: url, navigationError, allNetworkCount: responses.length, interestingCount: interesting.length }, null, 2));

await browser.close();
