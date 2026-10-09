import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { digest } from '../../../src/integrations/inference-history/common.js';
import { projectArtifact } from '../../../src/integrations/inference-history/artifact-projection.js';
import { createLocalSourceHistoryService } from '../../../src/integrations/inference-history/service.js';
import { __setArchiveWorkerFactoryForTests } from '../../../src/integrations/inference-history/embedding-runtime.js';
const base=path.resolve('temp/tasks/eg2-service-cancellation-tests');await fs.mkdir(base,{recursive:true});
const root=await fs.mkdtemp(path.join(base,'case-'));const source=path.join(root,'artifacts-0001.json');
await fs.writeFile(source,JSON.stringify(projectArtifact({text:'durable source evidence '.repeat(15),sourceSha256:'a'.repeat(64),locator:'source.txt',kind:'code',chunkChars:8000})));
let entered,releaseWork,confirmExit,accepted=false,closed=false;
const started=new Promise(resolve=>{entered=resolve;});
const workerExit=new Promise(resolve=>{confirmExit=resolve;});
__setArchiveWorkerFactoryForTests(config=>({
  config,effectiveInput:text=>config.passagePrefix+text,
  prepareBatch:async texts=>texts.map(text=>({text,tokenLength:text.length})),
  encodePrepared:()=>{entered();return new Promise(resolve=>{releaseWork=resolve;});},
  cancel:()=>{accepted=true;return workerExit;},
  dispose:async()=>{const receipt=await workerExit;assert.equal(receipt.workerStopped,true);closed=true;},
  waitForIdle:()=>workerExit,executionInfo:()=>({requestAccepted:accepted,workerStopped:closed})
}));
let service;
try{
  service=await createLocalSourceHistoryService({sources:[{path:source,sha256:digest(await fs.readFile(source))}],indexPath:path.join(root,'disposable-test-index.sqlite'),embeddings:{modelsDir:path.join(root,'models'),chunkChars:80,overlapChars:20,batchSize:2}});
  let returned=false;const indexing=service.indexEmbeddings().then(result=>{returned=true;return result;});
  await started;let cancelledReturned=false;const cancellation=service.cancelEmbeddings().then(receipt=>{cancelledReturned=true;return receipt;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(accepted,true);assert.equal(returned,false);assert.equal(cancelledReturned,false,'accepted request is not stopped proof');
  const stopped={requestAccepted:true,workerStopped:true,forced:true,exitCode:null,signal:'SIGKILL'};
  confirmExit(stopped);releaseWork([Float32Array.from({length:768},(_,i)=>i===0?1:0),Float32Array.from({length:768},(_,i)=>i===0?1:0)]);
  assert.equal((await cancellation).workerStopped,true);
  const result=await indexing;assert.equal(result.stopped,'cancelled');assert.equal(result.nativeCancellation.workerStopped,true);
  assert.equal(result.indexedSpans,0,'interrupted batch remains replayable');
  await service.dispose();assert.equal(closed,true);service=null;
}finally{await service?.dispose();__setArchiveWorkerFactoryForTests(null);}
console.log('Public archive cancellation waits for verified worker exit and discards interrupted batch (mock worker).');
