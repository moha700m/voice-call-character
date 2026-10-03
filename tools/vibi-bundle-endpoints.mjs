import fs from 'node:fs/promises';

const outDir='artifacts/vibi-bundle-endpoints';
await fs.mkdir(outDir,{recursive:true});
const H={'user-agent':'Mozilla/5.0','accept':'text/html,application/javascript,text/javascript,*/*'};
async function get(u){const c=new AbortController();const t=setTimeout(()=>c.abort(),12000);try{const r=await fetch(u,{headers:H,redirect:'follow',signal:c.signal});return {url:r.url,status:r.status,text:await r.text()}}catch(e){return {url:u,status:0,text:'',error:String(e?.message||e)}}finally{clearTimeout(t)}}

const root=await get('https://vibi.pro/docs');
const scripts=[];
for(const m of root.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)){try{scripts.push(new URL(m[1],root.url).href)}catch{}}
const fetched=await Promise.all([...new Set(scripts)].slice(0,100).map(get));

const endpoints=new Map();
const apiCalls=[];
const apiKeyContexts=[];
const modelVoiceContexts=[];
for(const s of fetched){
 const text=s.text||'';
 for(const m of text.matchAll(/["'`](\/v1\/[A-Za-z0-9_?=&./:{}-]+)["'`]/g)){
  const ep=m[1]; if(!endpoints.has(ep)) endpoints.set(ep,[]);
  const a=Math.max(0,m.index-260),b=Math.min(text.length,m.index+m[0].length+420);
  endpoints.get(ep).push({source:s.url,context:text.slice(a,b)});
 }
 for(const m of text.matchAll(/\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi)){
  const path=m[2];
  if(/\/v1\/|api|speech|voice|audio|tts|task|key|docs/i.test(path)) apiCalls.push({method:m[1].toUpperCase(),path,source:s.url,context:text.slice(Math.max(0,m.index-220),Math.min(text.length,m.index+m[0].length+500))});
 }
 for(const m of text.matchAll(/api[_-]?key|regenerate.{0,40}key|authorization|bearer/gi)){
  apiKeyContexts.push({source:s.url,context:text.slice(Math.max(0,m.index-320),Math.min(text.length,m.index+m[0].length+620))});
  if(apiKeyContexts.length>400) break;
 }
 for(const m of text.matchAll(/text-to-speech|voice[_-]?id|model[_-]?id|output[_-]?format|audio_url|credits_deducted/gi)){
  modelVoiceContexts.push({source:s.url,context:text.slice(Math.max(0,m.index-360),Math.min(text.length,m.index+m[0].length+800))});
  if(modelVoiceContexts.length>800) break;
 }
}
const report={generatedAt:new Date().toISOString(),rootStatus:root.status,scripts:fetched.map(x=>({url:x.url,status:x.status,size:x.text.length,error:x.error||null})),endpoints:[...endpoints].map(([path,hits])=>({path,hits:hits.slice(0,20)})).sort((a,b)=>a.path.localeCompare(b.path)),apiCalls:[...new Map(apiCalls.map(x=>[`${x.method} ${x.path}`,x])).values()].sort((a,b)=>(a.path||'').localeCompare(b.path||'')),apiKeyContexts:apiKeyContexts.slice(0,250),modelVoiceContexts:modelVoiceContexts.slice(0,500)};
await fs.writeFile(`${outDir}/report.json`,JSON.stringify(report,null,2));
await fs.writeFile(`${outDir}/endpoints.txt`,report.endpoints.map(e=>`${e.path}\n${e.hits.map(h=>h.context).join('\n---\n')}`).join('\n\n=====\n\n'));
await fs.writeFile(`${outDir}/api-calls.txt`,report.apiCalls.map(x=>`${x.method} ${x.path}\n${x.context}`).join('\n\n=====\n\n'));
await fs.writeFile(`${outDir}/api-key.txt`,report.apiKeyContexts.map(x=>x.context).join('\n\n=====\n\n'));
await fs.writeFile(`${outDir}/tts-details.txt`,report.modelVoiceContexts.map(x=>x.context).join('\n\n=====\n\n'));
console.log(JSON.stringify({endpoints:report.endpoints.map(e=>e.path),apiCalls:report.apiCalls.map(x=>`${x.method} ${x.path}`),apiKeyHits:report.apiKeyContexts.length,ttsHits:report.modelVoiceContexts.length},null,2));
