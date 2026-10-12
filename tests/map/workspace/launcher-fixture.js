import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
/** Launch the real map-iso command only against an already-built disposable fixture. */
export async function verifyMapIsoLauncher(repo,temp){
  const controller=new AbortController(),certDir=path.join(temp,'viewer-tls');let log='',readyResolve;
  const ready=new Promise(resolve=>{readyResolve=resolve;});
  const processResult=spawnSubprocess(process.execPath,['tools/analysis/map-iso-serve.js','--repo',repo,'--no-open','--cert-dir',certDir],{
    cwd:process.cwd(),env:process.env,signal:controller.signal,timeoutMs:15000,outputMode:'string',
    onStderr:chunk=>{log+=String(chunk);const match=log.match(/Serving map: (https:\/\/localhost:\d+\/map.iso.html)/);if(match)readyResolve(match[1]);}
  }).then(result=>({result}),error=>({error}));
  try{
    const url=await Promise.race([ready,processResult.then(result=>{throw new Error('Map launcher exited before readiness: '+log+' '+(result.error?.message||''));})]);
    const ca=await fs.readFile(path.join(certDir,'localhost.crt'));
    const get=pathname=>new Promise((resolve,reject)=>{
      // Trust exactly the generated fixture CA. TLS verification stays enabled.
      const request=https.get(new URL(pathname,url),{ca,family:4},response=>{let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;if(body.length>2*1024*1024)request.destroy(new Error('Fixture response too large'));});response.on('end',()=>resolve({status:response.statusCode,body,type:response.headers['content-type']}));});
      request.setTimeout(2000,()=>request.destroy(new Error('Fixture request timeout')));request.on('error',reject);
    });
    const html=await get('/map.iso.html');assert.equal(html.status,200);assert.match(html.body,/Semantic stacks|semantic stacks/);assert.match(html.body,/type="importmap"/);
    for(const asset of ['/isomap/viewer.js','/isomap/stack-model.js','/shared/config.js','/shared/iterables.js','/workspace/inspect.js']){const result=await get(asset);assert.equal(result.status,200,asset);assert.match(result.type,/javascript/);}
    assert.equal((await get('/shared/not-a-viewer-module.js')).status,404);
  }finally{controller.abort();await processResult;}
}
