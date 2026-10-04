import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const url = 'https://moha700m.github.io/voice-call-character/';
const out = 'artifacts/vibi-pages-qa';
await fs.mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ar-SA' });
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1500);

const title = await page.title();
const body = await page.locator('body').innerText();
const html = await page.content();
const connectMessage = await page.locator('#connectMsg').innerText();

if (!body.includes('سايبر × Vibi')) throw new Error('Vibi UI marker missing');
if (!body.includes('الموقع لا يطلب API Key')) throw new Error('secure backend notice missing');
if (body.includes('Vibi API Key') || page.locator('#apiKey').count() !== 0) throw new Error('browser API key input still present');
if (html.includes('agent_6401m373bj55ft0bnxpf57d7bq36') || html.includes('elevenlabs-convai')) throw new Error('obsolete ElevenLabs Agent integration still present');
if (!connectMessage.includes('Backend') && !connectMessage.includes('الاتصال عبر Backend')) throw new Error('secure backend status missing');

await page.screenshot({ path: `${out}/mobile.png`, fullPage: true });
await fs.writeFile(`${out}/report.json`, JSON.stringify({ url, title, connectMessage, consoleErrors }, null, 2));
console.log(JSON.stringify({ title, connectMessage, consoleErrors }, null, 2));
await browser.close();
