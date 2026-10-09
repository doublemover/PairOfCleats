import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createPersistentHistorySemanticIndex } from '../../../src/integrations/inference-history/persistent-semantic-index.js';
import { planHistoryTokenBatches } from '../../../src/integrations/inference-history/token-batches.js';

const plans = planHistoryTokenBatches([{text:'a'},{text:'b'},{text:'c'},{text:'d'}], [100,10,90,11],
  {batchSize:2,maxBatchChars:100,maxPaddedTokens:200,maxAttentionTokens:20000});
assert.deepEqual(plans, [[1,3],[2,0]], 'stable actual-token packing');
assert.throws(() => planHistoryTokenBatches([{text:'a'}], [100], {batchSize:2,maxBatchChars:100,maxPaddedTokens:50,maxAttentionTokens:20000}));

function fixture() {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
  db.exec([
    'CREATE TABLE vault_meta(key TEXT PRIMARY KEY,value TEXT);',
    "INSERT INTO vault_meta VALUES ('partition','test'),('reference_key','" + 'a'.repeat(64) + "'),('generation','1'),('updated_at','2026-10-09T00:00:00Z');",
    'CREATE TABLE records(id TEXT PRIMARY KEY,deleted INTEGER DEFAULT 0,excluded INTEGER DEFAULT 0,latest_snapshot TEXT);',
    'CREATE TABLE units(id TEXT PRIMARY KEY,record_id TEXT REFERENCES records(id) ON DELETE CASCADE,text TEXT,metadata TEXT);',
    'CREATE TABLE snapshot_units(unit_id TEXT,snapshot_id TEXT,path_state TEXT);'
  ].join('\n'));
  return db;
}
function add(db, id, text) {
  db.prepare('INSERT INTO records(id,latest_snapshot) VALUES (?,?)').run(id,'snapshot');
  db.prepare('INSERT INTO units VALUES (?,?,?,?)').run(id,id,text,'{}');
  db.prepare('INSERT INTO snapshot_units VALUES (?,?,?)').run(id,'snapshot','present');
}
let calls=0, release=null, beforeEncode=null;
const runtime = (documentKey='doc',dimensions=4,query='query') => ({
  config:{documentIdentityKey:documentKey,documentIdentity:{documentKey},queryIdentityKey:query,representationIdentityKey:'dims'+dimensions,
    fullDimensions:4,profile:{dimensions,revision:'revision'},modelId:'synthetic',batchSize:2,chunkChars:80,overlapChars:0,queryPrefix:'query:',passagePrefix:'passage:'},
  effectiveInput:text=>'passage:'+text,
  async prepareBatch(texts){return texts.map(text=>({text,tokenLength:text.length}));},
  async encodePrepared(items){calls++;await beforeEncode?.();if(release)await new Promise(resolve=>{release.resolve=resolve;});return items.map(()=>[1,1,1,1]);},
  async encodeQuery(){return Array(dimensions).fill(1);}
});
const db=fixture();
add(db,'a','same text');add(db,'b','same text');add(db,'c','different text');
let index=createPersistentHistorySemanticIndex(db,runtime());
const result=await index.refresh({maxUnits:10});
assert.equal(result.indexedUnits,3);assert.equal(result.indexedSpans,3);
assert.equal(result.encodedSpans,2);assert.equal(result.uniqueInputs,2);
assert.equal(db.prepare('SELECT count(*) n FROM history_embedding_spans_v2').get().n,3,'all occurrences retained');
const priorCalls=calls;
index=createPersistentHistorySemanticIndex(db,runtime('doc',2,'new query policy'));
assert.equal(index.status().indexedUnits,3,'query and representation reuse document generation');
assert.equal((await index.refresh()).encodedSpans,0);assert.equal(calls,priorCalls);
const retrieved=await index.adapter().search({query:'same',top:3,generationRef:index.status().generationRef,request:{query:'same'}},{reauthorize:async()=>{}});assert.equal(retrieved.candidates.length,3);
const second=createPersistentHistorySemanticIndex(db,runtime('another-document-generation'));
assert.equal(second.status().indexedSpans,0);
assert.equal(index.status().indexedSpans,3,'independent generation survives');
await second.refresh({maxUnits:10});
db.prepare('UPDATE records SET excluded=1 WHERE id=?').run('a');
assert.equal(index.status().indexedSpans,2);
assert.equal(index.status().uniqueInputs,2,'shared input retained for visible occurrence');
db.prepare('UPDATE records SET deleted=1 WHERE id=?').run('b');
assert.equal(index.status().uniqueInputs,1,'last occurrence removes private cached text/vector in every generation');
assert.equal(second.status().uniqueInputs,1);
db.prepare('UPDATE units SET text=? WHERE id=?').run('changed','c');
assert.equal(index.status().indexedSpans,0);assert.equal(index.status().uniqueInputs,0);
db.close();

const limited=fixture();add(limited,'a','one');add(limited,'b','two');
index=createPersistentHistorySemanticIndex(limited,runtime());
await assert.rejects(index.refresh({maxUnits:10,maxCacheInputs:1}),{code:'ERR_INFERENCE_HISTORY_LIMIT'});
assert.equal(index.status().uniqueInputs,0,'capacity rejection never partly publishes a batch');limited.close();

const cancellation=fixture();add(cancellation,'a','one');add(cancellation,'b','two');
const controller=new AbortController();release={};
index=createPersistentHistorySemanticIndex(cancellation,runtime());
const pending=index.refresh({maxUnits:10,signal:controller.signal});
await new Promise(resolve=>setImmediate(resolve));controller.abort();
const cancelled=await pending;
assert.equal(cancelled.stopped,'cancelled');assert.equal(cancelled.indexedSpans,0);
assert.equal(cancelled.nativeWorkPending,true,'timeout does not prove native work stopped');
assert.deepEqual(cancelled.nativeCancellation,{supported:false,requestAccepted:false,workerStopped:false});
await assert.rejects(index.refresh(),{code:'ERR_INFERENCE_HISTORY_LIMIT'});
release.resolve();release=null;await new Promise(resolve=>setImmediate(resolve));
assert.equal(index.status().indexedSpans,0,'late native completion never commits');
assert.equal((await index.refresh({maxUnits:10})).indexedUnits,2);
cancellation.close();


const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const workerDb=fixture();add(workerDb,'a','first');add(workerDb,'b','second');add(workerDb,'c','third');
const workerController=new AbortController(), workStarted=deferred(), workExit=deferred(), cancellationRequested=deferred();
let workerCalls=0, workerCancelCalls=0;
const workerRuntime={
  ...runtime(),
  async encodePrepared(items){
    workerCalls++;
    if(workerCalls===2){workStarted.resolve();await workExit.promise;}
    return items.map(()=>[1,1,1,1]);
  },
  async cancel(reason){
    workerCancelCalls++;assert.equal(reason,'cancelled');cancellationRequested.resolve();
    await workExit.promise;
    return {requestAccepted:true,workerStopped:true,exitCode:0};
  }
};
index=createPersistentHistorySemanticIndex(workerDb,workerRuntime);
let reported=false;
const workerRefresh=index.refresh({maxUnits:10,batchSize:1,lookahead:1,signal:workerController.signal}).then(value=>{reported=true;return value;});
await workStarted.promise;workerController.abort();await cancellationRequested.promise;
await new Promise(resolve=>setImmediate(resolve));
assert.equal(reported,false,'refresh never reports stop before cancellation confirms worker exit');
assert.equal(index.status().nativeWorkPending,true);
assert.equal(index.status().indexedUnits,1,'earlier completed batch remains durable');
assert.equal(index.status().indexedSpans,1,'interrupted batch is not committed');
await assert.rejects(index.refresh(),{code:'ERR_INFERENCE_HISTORY_LIMIT'});
workExit.resolve();
const workerStopped=await workerRefresh;
assert.deepEqual(workerStopped.nativeCancellation,{requestAccepted:true,workerStopped:true,exitCode:0,supported:true});
assert.equal(workerStopped.nativeWorkPending,false);
assert.equal(workerStopped.indexedSpans,1,'late interrupted output never commits even after exit');
assert.equal(workerCancelCalls,1);assert.equal(workerCalls,2,'no automatic resubmission');
index=createPersistentHistorySemanticIndex(workerDb,runtime());
const fresh=await index.refresh({maxUnits:10});
assert.equal(fresh.indexedUnits,3);assert.equal(fresh.encodedSpans,2,'fresh runtime resumes only missing durable spans');
workerDb.close();

const unconfirmedDb=fixture();add(unconfirmedDb,'a','waiting');
const unconfirmedWork=deferred();let requests=0;
index=createPersistentHistorySemanticIndex(unconfirmedDb,{
  ...runtime(),async encodePrepared(){await unconfirmedWork.promise;return [[1,1,1,1]];},
  async cancel(reason){assert.equal(reason,'deadline');requests++;return {requestAccepted:true,workerStopped:false};}
});
const keepAlive=setInterval(()=>{},1000);
let unconfirmed;
try{unconfirmed=await index.refresh({maxUnits:10,maxMillis:100});}finally{clearInterval(keepAlive);}
assert.equal(unconfirmed.stopped,'deadline');
assert.equal(unconfirmed.nativeCancellation.requestAccepted,true);
assert.equal(unconfirmed.nativeCancellation.workerStopped,false,'accepted stop request is not confirmed process exit');
assert.equal(unconfirmed.nativeWorkPending,true);
assert.equal(unconfirmed.indexedSpans,0);assert.equal(requests,1);
await assert.rejects(index.refresh(),{code:'ERR_INFERENCE_HISTORY_LIMIT'});
unconfirmedWork.resolve();await new Promise(resolve=>setImmediate(resolve));
assert.equal(index.status().indexedSpans,0);
unconfirmedDb.close();

const stale=fixture();add(stale,'a','one');
index=createPersistentHistorySemanticIndex(stale,runtime());
beforeEncode=()=>stale.prepare("UPDATE vault_meta SET value='2' WHERE key='generation'").run();
await assert.rejects(index.refresh(),{code:'ERR_INFERENCE_HISTORY_STALE'});
assert.equal(index.status().indexedSpans,0);beforeEncode=null;stale.close();
const old=fixture();old.exec('CREATE TABLE history_embedding_meta(singleton INTEGER)');
assert.throws(()=>createPersistentHistorySemanticIndex(old,runtime()),{code:'ERR_INFERENCE_HISTORY_STORAGE'});old.close();
console.log('SYNTHETIC archive v2: token packing, complete-input reuse/fanout, independent identities, privacy GC, native cancellation fence, stale generation and conversion gate passed');
