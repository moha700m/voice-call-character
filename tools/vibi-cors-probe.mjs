const origin='https://moha700m.github.io';
const targets=[
  ['GET','https://api.vibi.pro/v1/models'],
  ['GET','https://api.vibi.pro/v1/minimax/system-voices'],
  ['POST','https://api.vibi.pro/v1/text-to-speech/test'],
  ['POST','https://api.vibi.pro/v1/speech-to-text']
];
for(const [method,url] of targets){
  try{
    const res=await fetch(url,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':method,'Access-Control-Request-Headers':'content-type,xi-api-key'}});
    console.log(JSON.stringify({url,status:res.status,acao:res.headers.get('access-control-allow-origin'),methods:res.headers.get('access-control-allow-methods'),headers:res.headers.get('access-control-allow-headers'),credentials:res.headers.get('access-control-allow-credentials')}));
  }catch(e){console.log(JSON.stringify({url,error:String(e?.message||e)}))}
}
