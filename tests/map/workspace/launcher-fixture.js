import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
/** Launch the real map-iso command only against an already-built disposable fixture. */
export async function verifyMapIsoLauncher(repo){
  const controller=new AbortController();let log='',output='',readyResolve;
  const ready=new Promise(resolve=>{readyResolve=resolve;});
  const processResult=spawnSubprocess(process.execPath,['bin/pairofcleats.js','report','map','--serve','--repo',repo,'--no-open'],{
    cwd:process.cwd(),env:process.env,signal:controller.signal,timeoutMs:15000,outputMode:'string',
    onStderr:chunk=>{log+=String(chunk);},
    onStdout:chunk=>{output+=String(chunk);for(const line of output.split('\n').slice(0,-1)){const event=JSON.parse(line);if(event.type==='map-preview-ready'){assert.equal(event.lifecycle,'listener-ready');assert.match(event.clientAssetIdentity,/^[a-f0-9]{64}$/);readyResolve(event.url);}}}
  }).then(result=>({result}),error=>({error}));
  try{
    const url=await Promise.race([ready,processResult.then(result=>{throw new Error('Map launcher exited before readiness: '+log+' '+(result.error?.message||''));})]);
    const get=pathname=>new Promise((resolve,reject)=>{
      const request=http.get(new URL(pathname,url),response=>{let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;if(body.length>2*1024*1024)request.destroy(new Error('Fixture response too large'));});response.on('end',()=>resolve({status:response.statusCode,body,type:response.headers['content-type']}));});
      request.setTimeout(2000,()=>request.destroy(new Error('Fixture request timeout')));request.on('error',reject);
    });
    const html=await get('/map.iso.html');assert.equal(html.status,200);assert.match(html.body,/Semantic stacks|semantic stacks/);assert.match(html.body,/type="importmap"/);
    for(const asset of ['/isomap/viewer.js','/isomap/stack-model.js','/shared/config.js','/shared/iterables.js','/workspace/inspect.js']){const result=await get(asset);assert.equal(result.status,200,asset);assert.match(result.type,/javascript/);}
    assert.equal((await get('/shared/not-a-viewer-module.js')).status,404);
  }finally{controller.abort();await processResult;}
}
