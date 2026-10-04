import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const out = 'artifacts/secure-vibi-bridge-qa';
await fs.mkdir(out, { recursive: true });

const indexHtml = await fs.readFile('docs/index.html', 'utf8');
const appJs = await fs.readFile('docs/app.js', 'utf8');
const styles = await fs.readFile('docs/styles.css', 'utf8');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-SA' });
const page = await context.newPage();
const consoleMessages = [];
page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text() }));

await page.route('https://moha700m.github.io/voice-call-character/**', async (route) => {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname.endsWith('/app.js')) {
    await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: appJs });
    return;
  }
  if (pathname.endsWith('/styles.css')) {
    await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: styles });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: indexHtml });
});

await page.goto('https://moha700m.github.io/voice-call-character/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => document.querySelector('#connectionBadge')?.textContent !== 'جاري الاتصال…', null, { timeout: 30000 });

const badge = await page.locator('#connectionBadge').innerText();
const message = await page.locator('#connectMsg').innerText();
const workspaceVisible = await page.locator('#workspace').isVisible();
const voiceCount = await page.locator('#voice option').count();
const modelCount = await page.locator('#model option').count();

await page.screenshot({ path: `${out}/mobile.png`, fullPage: true });
await fs.writeFile(`${out}/report.json`, JSON.stringify({ badge, message, workspaceVisible, voiceCount, modelCount, consoleMessages }, null, 2));

console.log(JSON.stringify({ badge, message, workspaceVisible, voiceCount, modelCount, consoleMessages }, null, 2));

if (badge !== 'Vibi متصل') throw new Error(`secure bridge did not connect: ${badge} / ${message}`);
if (!workspaceVisible) throw new Error('workspace stayed hidden after secure connection');
if (!modelCount) throw new Error('Vibi models did not load through secure bridge');
if (!voiceCount) throw new Error('Vibi voices did not load through secure bridge');

await browser.close();
