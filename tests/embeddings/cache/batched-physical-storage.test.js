import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {readCacheIndex,writeCacheEntries,readCacheEntries,encodeCacheEntryPayload,
  createShardAppendHandlePool,createCacheBatchReader,flushCacheIndex,resolveCacheShardPath} from '../../../tools/build/embeddings/cache.js';
const parent=process.env.PAIROFCLEATS_VECTOR_CACHE_TEST_DIR||path.resolve('temp/tasks/retrieval-vector-cache');
await fs.mkdir(parent,{recursive:true});const dir=await fs.mkdtemp(path.join(parent,'cache-'));
await fs.writeFile(path.join(dir,'preserved-source.log'),'owner log');
const index=await readCacheIndex(dir,'fixture');
const keys=Array.from({length:5},(_,id)=>String(id+1).repeat(40));
const payload=(key,id)=>({key,file:'src/'+id,hash:'hash',cacheMeta:{identityKey:'fixture'},
  codeVectors:[[id,2,3]],docVectors:[[id,4,5]],mergedVectors:[[id,6,7]]});
const pool=createShardAppendHandlePool();
for(let round=0;round<4;round++){
  const writes=await Promise.all(keys.map(async(key,id)=>({cacheKey:key,payload:payload(key,id),encodedPayload:await encodeCacheEntryPayload(payload(key,id))})));
  await writeCacheEntries(dir,index,writes,{shardHandlePool:pool});
}
await pool.close();
const stale=structuredClone(index);
const originalOpen=fs.open;
let opens=0,reads=0;
fs.open=async(...args)=>{
  const handle=await originalOpen(...args);
  if(String(args[0]).includes(path.sep+'shards'+path.sep)&&args[1]==='r'){
    opens++;const read=handle.read.bind(handle);handle.read=(...parameters)=>{reads++;return read(...parameters);};
  }
  return handle;
};
let batch;try{batch=await readCacheEntries(dir,keys,index);}finally{fs.open=originalOpen;}
assert.equal(opens,1);assert.equal(reads,1,'Adjacent entries should use one bounded range read');
batch.forEach((entry,id)=>assert.deepEqual(Array.from(entry.entry.mergedVectors[0]),[id,6,7]));
const liveBytes=Object.values(index.entries).reduce((sum,entry)=>sum+entry.sizeBytes,0);
const metadataNames=(await fs.readdir(dir)).filter(name=>name.startsWith('cache.index'));
const metadataBytes=(await Promise.all(metadataNames.map(async name=>(await fs.stat(path.join(dir,name))).size))).reduce((sum,size)=>sum+size,0);
const budget=metadataBytes+Math.ceil(liveBytes*1.2)+512;
const batchReader=createCacheBatchReader({cacheDir:dir,cacheIndex:index});
const coalesced=await Promise.all(keys.map(key=>batchReader.read(key)));
await batchReader.drain();coalesced.forEach((entry,id)=>assert.deepEqual(Array.from(entry.entry.mergedVectors[0]),[id,6,7]));
assert.equal(batchReader.stats().pendingBytes,0);
const result=await flushCacheIndex(dir,index,{identityKey:'fixture',maxBytes:budget});
assert.ok(result.compaction.copiedBytes>0);assert.ok(result.compaction.reclaimedBytes>0);
assert.ok(result.physicalBytesBefore>result.physicalBytes);
assert.ok(result.physicalBytes<=budget);
assert.equal(result.budgetExceeded,false);
assert.equal(Object.keys(index.entries).length,5,'Compaction should retain live entries');
const after=await readCacheEntries(dir,keys,index);
after.forEach((entry,id)=>assert.deepEqual(Array.from(entry.entry.mergedVectors[0]),[id,6,7]));
await flushCacheIndex(dir,stale,{identityKey:'fixture',maxBytes:budget});
const reopened=await readCacheIndex(dir,'fixture');
assert.deepEqual(Object.values(reopened.entries).map(entry=>entry.shard),Object.values(index.entries).map(entry=>entry.shard),'Stale worker must not revive retired shard pointers');
assert.equal(await fs.readFile(path.join(dir,'preserved-source.log'),'utf8'),'owner log');
assert.equal(resolveCacheShardPath(dir,'../outside.bin'),null);
console.log('Batched shard I/O, physical budgets, bounded live-entry compaction, stale-pointer protection and log preservation passed');
