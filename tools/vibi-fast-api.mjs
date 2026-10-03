import fs from 'node:fs/promises';

const outDir = 'artifacts/vibi-fast-api';
await fs.mkdir(outDir, { recursive: true });

const headers = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
  accept: 'text/html,application/json,text/plain,*/*',
};

async function get(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'follow', headers, signal: controller.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, url, finalUrl: res.url, contentType: res.headers.get('content-type') || '', text };
  } catch (error) {
    return { ok: false, status: 0, url, finalUrl: url, contentType: '', text: '', error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

const pages = [
  'https://vibi.pro/',
  'https://vibi.pro/docs',
  'https://api.vibi.pro/openapi.json',
  'https://api.vibi.pro/swagger.json',
  'https://api.vibi.pro/docs',
  'https://api.vibi.pro/api-docs',
  'https://api.vibi.pro/v1/openapi.json',
  'https://api.vibi.pro/v1/docs',
];

const results = await Promise.all(pages.map((u) => get(u)));
for (const r of results) {
  const name = r.url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0,140);
  await fs.writeFile(`${outDir}/${name}.txt`, JSON.stringify({ ...r, text: undefined }, null, 2) + '\n\n' + r.text.slice(0,2_000_000));
}

const htmlSources = results.filter((r) => /text\/html/i.test(r.contentType) || /<html/i.test(r.text));
const scriptUrls = new Set();
for (const r of htmlSources) {
  for (const m of r.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    try { scriptUrls.add(new URL(m[1], r.finalUrl).href); } catch {}
  }
}

const scripts = await Promise.all([...scriptUrls].slice(0,80).map((u) => get(u, 15000)));
const corpusParts = [];
for (const r of [...results, ...scripts]) {
  if (r.text) corpusParts.push(`\n/* SOURCE ${r.finalUrl} */\n${r.text.slice(0,2_000_000)}`);
}
const corpus = corpusParts.join('\n');

const endpoints = new Set();
for (const m of corpus.matchAll(/https:\/\/api\.vibi\.pro[^"'`\\\s)<>]*/gi)) endpoints.add(m[0]);
for (const m of corpus.matchAll(/\/v1\/[a-zA-Z0-9_?=&./:{}-]+/g)) endpoints.add(m[0]);

const takeContexts = (regex, before=220, after=420, limit=300) => {
  const out=[];
  for (const m of corpus.matchAll(regex)) {
    const s=Math.max(0,m.index-before), e=Math.min(corpus.length,m.index+m[0].length+after);
    out.push(corpus.slice(s,e));
    if(out.length>=limit) break;
  }
  return [...new Set(out)];
};

const authContexts = takeContexts(/authorization|bearer|x-api-key|api[_-]?key|access[_-]?token/gi);
const ttsContexts = takeContexts(/text-to-speech|speech-to-text|voice[_-]?id|model[_-]?id|elevenlabs|minimax|output[_-]?format|audio\/mpeg|audio\/wav/gi,260,620,500);
const docsContexts = takeContexts(/curl|fetch\(|POST\s+\/v1\/|GET\s+\/v1\/|request body|response body/gi,220,520,300);

const report = {
  generatedAt: new Date().toISOString(),
  pageStatuses: results.map(({url, finalUrl, status, contentType, error}) => ({url, finalUrl, status, contentType, error: error || null})),
  scriptUrls: [...scriptUrls],
  endpoints: [...endpoints].sort(),
  authContexts,
  ttsContexts,
  docsContexts,
};

await fs.writeFile(`${outDir}/report.json`, JSON.stringify(report,null,2));
await fs.writeFile(`${outDir}/auth.txt`, authContexts.join('\n\n---\n\n'));
await fs.writeFile(`${outDir}/tts.txt`, ttsContexts.join('\n\n---\n\n'));
await fs.writeFile(`${outDir}/docs-context.txt`, docsContexts.join('\n\n---\n\n'));
console.log(JSON.stringify({ pageStatuses: report.pageStatuses, endpoints: report.endpoints, authHits: authContexts.length, ttsHits: ttsContexts.length, docsHits: docsContexts.length }, null, 2));
