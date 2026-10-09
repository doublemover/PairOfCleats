import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { digest } from '../../../src/integrations/inference-history/common.js';
import { projectArtifact } from '../../../src/integrations/inference-history/artifact-projection.js';
import { createLocalSourceHistoryService } from '../../../src/integrations/inference-history/service.js';
import { resolveArchiveEmbeddingOptions, ARCHIVE_EG2_QUERY_PREFIX, __setArchiveWorkerFactoryForTests } from '../../../src/integrations/inference-history/embedding-runtime.js';
const base=process.env.PAIROFCLEATS_ARCHIVE_DISCOVERY_TEST_DIR||path.resolve('temp/tasks/archive-eg2-tests');
await fs.mkdir(base,{recursive:true});
const root=await fs.realpath(await fs.mkdtemp(path.join(base,'persistent-eg2-')));
const sources=path.join(root,'artifacts-0001.json');
const docs=[
  ...projectArtifact({text:Array.from({length:150},(_,i)=>'rocket orbit launch '+i+' ').join(''),sourceSha256:'a'.repeat(64),locator:'rocket.txt',kind:'code',chunkChars:8000}),
  ...projectArtifact({text:'gardening flower soil '.repeat(40),sourceSha256:'b'.repeat(64),locator:'garden.txt',kind:'code',chunkChars:8000})
];
await fs.writeFile(sources,JSON.stringify(docs));
const config={modelsDir:path.join(root,'models'),dimensions:128,chunkChars:80,overlapChars:20,batchSize:2};
const standard=resolveArchiveEmbeddingOptions({modelsDir:config.modelsDir});
assert.equal(standard.profile.dtype,'fp32');assert.equal(standard.profile.dimensions,768);
assert.equal(standard.localFilesOnly,true);
assert.equal(resolveArchiveEmbeddingOptions({...config,dimensions:256}).documentIdentityKey,resolveArchiveEmbeddingOptions(config).documentIdentityKey);
assert.notEqual(resolveArchiveEmbeddingOptions({...config,dimensions:256}).representationIdentityKey,resolveArchiveEmbeddingOptions(config).representationIdentityKey);
assert.equal(resolveArchiveEmbeddingOptions({...config,batchSize:8}).identityKey,resolveArchiveEmbeddingOptions(config).identityKey);
assert.throws(()=>resolveArchiveEmbeddingOptions({...config,dimensions:129}));
for(const change of [{dtype:'q8'},{revision:'c'.repeat(40)}])assert.notEqual(resolveArchiveEmbeddingOptions({...config,...change}).identityKey,resolveArchiveEmbeddingOptions(config).identityKey);
assert.equal(resolveArchiveEmbeddingOptions({...config,task:'code'}).documentIdentityKey,resolveArchiveEmbeddingOptions(config).documentIdentityKey);
let calls=0,cancelAt=Infinity,cancel=null,queryCalls=0;
let durableSpans=0;
const inputs=[];
__setArchiveWorkerFactoryForTests(options=>{
  assert.equal(options.localFilesOnly,true);
  const dimensions=options.fullProfile.dimensions;
  const vector=text=>{const value=new Float32Array(dimensions);value[/rocket|spacecraft/.test(text)?0:1]=1;return value;};
  return {
    config:options,effectiveInput:text=>options.passagePrefix+text,
    waitForIdle:async()=>{},dispose:async()=>{},
    cancel:async()=>({requestAccepted:true,workerStopped:true,forced:false,exitCode:0,signal:null}),
    async prepareBatch(texts){return texts.map(text=>({text:options.passagePrefix+text,tokenLength:text.length+options.passagePrefix.length}));},
    async encodePrepared(items){calls++;const texts=items.map(item=>item.text);inputs.push(...texts);if(calls===cancelAt)cancel.abort();return texts.map(vector);},
    async encodeQuery(text){queryCalls++;const effective=options.queryPrefix+text;assert.ok(effective.startsWith(ARCHIVE_EG2_QUERY_PREFIX));return vector(effective).slice(0,options.profile.dimensions);}
  };
});
const options={sources:[{path:sources,sha256:digest(await fs.readFile(sources))}],indexPath:path.join(root,'archive.sqlite'),embeddings:config};
let service;
try{
  service=await createLocalSourceHistoryService(options);
  assert.equal(service.embeddingStatus().totalUnits,2);
  assert.equal((await service.search({query:'rocket'})).query.retrievalMode,'lexical','unindexed auto skips model work');
  assert.equal(queryCalls,0);
  cancel=new AbortController();cancelAt=calls+2;
  const stopped=await service.indexEmbeddings({maxUnits:1,batchSize:2,signal:cancel.signal});
  assert.equal(stopped.stopped,'cancelled');assert.equal(stopped.indexedUnits,0);
  durableSpans=stopped.indexedSpans;assert.ok(durableSpans>=2,'first batch remains durable before cancellation');
  assert.equal((await service.search({query:'rocket'})).query.retrievalMode,'lexical','incomplete units must not publish vectors');
  await assert.rejects(service.search({query:'rocket',mode:'semantic'}),{code:'ERR_INFERENCE_HISTORY_UNAVAILABLE'});
  await service.dispose();
  cancelAt=Infinity;
  service=await createLocalSourceHistoryService(options);
  assert.equal(service.embeddingStatus().indexedSpans,durableSpans);
  const resumed=await service.indexEmbeddings({maxUnits:1,batchSize:2});
  assert.ok(resumed.reusedSpans>=durableSpans,'resume skips durable spans and exact repeated inputs');
  assert.equal(resumed.indexedUnits,1);assert.equal(resumed.complete,false);
  await service.dispose();
  service=await createLocalSourceHistoryService(options);
  const complete=await service.indexEmbeddings({maxUnits:10,batchSize:2});
  assert.equal(complete.indexedUnits,2);assert.equal(complete.complete,true);
  const oldCalls=calls;
  assert.equal((await service.indexEmbeddings()).encodedSpans,0);
  assert.equal(calls,oldCalls);
  assert.ok(inputs.every(t=>t.startsWith('title: none | text: ')));
  const semantic=await service.search({query:'spacecraft',mode:'semantic',candidateLimit:1,top:1});
  assert.equal(semantic.hits.length,1);assert.match(semantic.hits[0].text,/rocket/);
  assert.equal(semantic.query.semanticMatching,true);
  assert.equal(semantic.semantic.dimensions,128);
  assert.equal(semantic.semantic.coverage.indexedUnits,2);
  const hybrid=await service.search({query:'spacecraft',mode:'auto',candidateLimit:2});
  assert.equal(hybrid.query.retrievalMode,'hybrid');assert.ok(hybrid.hits.length);
  assert.equal((await service.search({query:'rocket',searchField:'path'})).query.retrievalMode,'lexical','native metadata surface stays lexical');
  const excluded=await service.search({query:'spacecraft -rocket',mode:'semantic',candidateLimit:1});
  assert.ok(excluded.hits.every(h=>!h.text.includes('rocket')));
  const role=await service.search({query:'spacecraft',mode:'semantic',role:'assistant',candidateLimit:1});
  assert.equal(role.hits.length,0,'eligibility applied before top-N');
  await service.dispose();
  const db=new Database(options.indexPath);
  db.pragma('foreign_keys=ON');
  const unit=db.prepare('SELECT id FROM units ORDER BY id LIMIT 1').get();
  db.prepare('UPDATE units SET text=text||? WHERE id=?').run(' changed',unit.id);
  assert.equal(db.prepare('SELECT count(*) AS n FROM history_embedding_units_v2 WHERE unit_id=?').get(unit.id).n,0,'source update invalidates vectors');
  db.close();
  service=await createLocalSourceHistoryService(options);
  assert.equal(service.embeddingStatus().pendingUnits,1);
  await service.dispose();
  service=await createLocalSourceHistoryService({...options,embeddings:{...config,dimensions:256}});
  assert.ok(service.embeddingStatus().indexedSpans>0,'different dimensions derive from retained full vectors');
  assert.equal(service.embeddingStatus().pendingUnits,1);
  await service.dispose();service=null;
  console.log('SYNTHETIC encoder: local factory wiring, prompt/default identity, persisted resume, cancellation, incremental invalidation, independent hybrid candidates and pre-cap eligibility passed');
}finally{await service?.dispose();__setArchiveWorkerFactoryForTests(null);}
