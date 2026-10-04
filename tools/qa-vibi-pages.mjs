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

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => document.querySelector('#connectionBadge')?.textContent === 'Vibi متصل', null, { timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll('#model option').length > 0 && document.querySelectorAll('#voice option').length > 0, null, { timeout: 20000 });

const title = await page.title();
const body = await page.locator('body').innerText();
const html = await page.content();
const connectMessage = await page.locator('#connectMsg').innerText();
const ttsMessage = await page.locator('#ttsMsg').innerText();
const badge = await page.locator('#connectionBadge').innerText();
const workspaceVisible = await page.locator('#workspace').isVisible();
const modelCount = await page.locator('#model option').count();
const voiceCount = await page.locator('#voice option').count();

if (!body.includes('سايبر × Vibi')) throw new Error('Vibi UI marker missing');
if (!body.includes('الموقع لا يطلب API Key')) throw new Error('secure backend notice missing');
if (await page.locator('#apiKey').count()) throw new Error('browser API key input still present');
if (html.includes('agent_6401m373bj55ft0bnxpf57d7bq36') || html.includes('elevenlabs-convai')) throw new Error('obsolete ElevenLabs Agent integration still present');
if (!connectMessage.includes('Backend')) throw new Error(`secure backend status missing: ${connectMessage}`);
if (!workspaceVisible || badge !== 'Vibi متصل') throw new Error(`Vibi secure connection not ready: badge=${badge}; message=${connectMessage}`);
if (!modelCount || !voiceCount) throw new Error(`Vibi catalog missing: models=${modelCount}; voices=${voiceCount}; tts=${ttsMessage}`);
if (consoleErrors.length) throw new Error(`console errors: ${consoleErrors.join(' | ')}`);

await page.screenshot({ path: `${out}/mobile.png`, fullPage: true });
await fs.writeFile(`${out}/report.json`, JSON.stringify({ url, title, connectMessage, ttsMessage, badge, workspaceVisible, modelCount, voiceCount, consoleErrors }, null, 2));
console.log(JSON.stringify({ title, connectMessage, ttsMessage, badge, workspaceVisible, modelCount, voiceCount, consoleErrors }, null, 2));
await browser.close();
