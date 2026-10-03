import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const outDir = 'artifacts/vibi-deep-probe';
await fs.mkdir(outDir, { recursive: true });

const targets = [
  'https://vibi.pro/docs',
  'https://api.vibi.pro/openapi.json',
  'https://api.vibi.pro/swagger.json',
  'https://api.vibi.pro/docs',
  'https://api.vibi.pro/api-docs',
  'https://api.vibi.pro/v1/openapi.json',
  'https://api.vibi.pro/v1/docs',
];

const safeName = (value) => value.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 140);
const snippets = [];

async function fetchPublic(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
        accept: 'text/html,application/json,text/plain,*/*',
      },
    });
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    return { url, finalUrl: res.url, status: res.status, contentType, body: text.slice(0, 2_000_000) };
  } catch (error) {
    return { url, finalUrl: url, status: 0, contentType: '', error: String(error?.message || error), body: '' };
  }
}

for (const target of targets) {
  const result = await fetchPublic(target);
  const filename = `${outDir}/${safeName(target)}.txt`;
  await fs.writeFile(filename, JSON.stringify({ ...result, body: undefined }, null, 2) + '\n\n' + result.body);
  snippets.push({ url: target, finalUrl: result.finalUrl, status: result.status, contentType: result.contentType, error: result.error || null, bodyStart: result.body.slice(0, 5000) });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'en-US',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
});
const page = await context.newPage();

const network = [];
page.on('response', async (res) => {
  const req = res.request();
  const item = {
    method: req.method(),
    url: res.url(),
    status: res.status(),
    resourceType: req.resourceType(),
    contentType: res.headers()['content-type'] || '',
  };
  network.push(item);
});

let navError = null;
try {
  await page.goto('https://vibi.pro/docs', { waitUntil: 'networkidle', timeout: 60_000 });
} catch (error) {
  navError = String(error?.message || error);
}

const title = await page.title().catch(() => '');
const finalUrl = page.url();
const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
const links = await page.locator('a').evaluateAll((els) => els.slice(0, 800).map((a) => ({ text: (a.textContent || '').trim().slice(0, 250), href: a.href }))).catch(() => []);
const scriptUrls = await page.locator('script[src]').evaluateAll((els) => els.map((s) => s.src)).catch(() => []);

await page.screenshot({ path: `${outDir}/docs.png`, fullPage: true }).catch(() => {});
await fs.writeFile(`${outDir}/docs.html`, await page.content().catch(() => ''));
await fs.writeFile(`${outDir}/docs-text.txt`, bodyText);

const scriptFindings = [];
for (const url of scriptUrls.slice(0, 120)) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) continue;
    const text = await res.text();
    const matches = [];
    const patterns = [
      /https:\/\/api\.vibi\.pro[^"'`\\\s)]*/gi,
      /\/v1\/[a-zA-Z0-9_?=&./:{}-]+/g,
      /text-to-speech/gi,
      /speech-to-text/gi,
      /elevenlabs/gi,
      /minimax/gi,
      /authorization/gi,
      /bearer/gi,
      /x-api-key/gi,
      /api[_-]?key/gi,
      /voice[_-]?id/gi,
      /model[_-]?id/gi,
    ];
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        const start = Math.max(0, m.index - 180);
        const end = Math.min(text.length, m.index + m[0].length + 280);
        matches.push(text.slice(start, end));
        if (matches.length >= 120) break;
      }
      if (matches.length >= 120) break;
    }
    if (matches.length) scriptFindings.push({ url, matches: [...new Set(matches)].slice(0, 120) });
  } catch {}
}

const endpointSet = new Set();
const combined = [bodyText, JSON.stringify(links), JSON.stringify(scriptFindings)].join('\n');
for (const m of combined.matchAll(/https:\/\/api\.vibi\.pro[^"'`\\\s)<>]*/gi)) endpointSet.add(m[0]);
for (const m of combined.matchAll(/\/v1\/[a-zA-Z0-9_?=&./:{}-]+/g)) endpointSet.add(m[0]);

const authHints = [...new Set((combined.match(/(?:authorization|bearer|x-api-key|api[_-]?key)[^\n]{0,180}/gi) || []).slice(0, 200))];
const speechHints = [...new Set((combined.match(/[^\n]{0,100}(?:text-to-speech|speech-to-text|voice[_-]?id|model[_-]?id|elevenlabs|minimax)[^\n]{0,220}/gi) || []).slice(0, 300))];

const report = {
  generatedAt: new Date().toISOString(),
  docs: { title, finalUrl, navigationError: navError },
  directFetches: snippets,
  endpoints: [...endpointSet].sort(),
  authHints,
  speechHints,
  links,
  scriptUrls,
  scriptFindings,
  interestingNetwork: network.filter((x) => /vibi|api|docs|auth|speech|tts|eleven|minimax|voice|model/i.test(x.url)),
  networkCount: network.length,
};

await fs.writeFile(`${outDir}/report.json`, JSON.stringify(report, null, 2));
await fs.writeFile(`${outDir}/network.json`, JSON.stringify(network, null, 2));
console.log(JSON.stringify({ title, finalUrl, navError, endpoints: report.endpoints, authHintsCount: authHints.length, speechHintsCount: speechHints.length, networkCount: network.length }, null, 2));

await browser.close();
