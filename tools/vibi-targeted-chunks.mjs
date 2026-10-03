import fs from 'node:fs/promises';
const out='artifacts/vibi-targeted-chunks'; await fs.mkdir(out,{recursive:true});
const base='https://vibi.pro/assets/';
const files=[
'PublicAPIDocs-kIMi7Zzd.js',
'get-api-key-C3vvgdzz.js',
'regenerate-api-key-Db2pXGFY.js',
'list-system-voices-Cew3fF7X.js',
'list-system-voices-Bg7qwgk6.js',
'get-models-W7AKDk0M.js',
'text-to-speech-DdZFgIIb.js',
'speech-to-text-BV-c2vta.js',
'create-dialogue-59qiF9FS.js',
'get-history-detail-DcbfXt5y.js',
'get-history-CRlUqhFj.js',
'retry-task-LXgKVoas.js'
];
const results=[];
for(const f of files){
 try{
  const r=await fetch(base+f,{headers:{'user-agent':'Mozilla/5.0','accept':'application/javascript,*/*'}});
  const t=await r.text();
  await fs.writeFile(`${out}/${f}`,t);
  results.push({file:f,status:r.status,size:t.length});
 }catch(e){results.push({file:f,status:0,size:0,error:String(e?.message||e)})}
}
await fs.writeFile(`${out}/manifest.json`,JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
