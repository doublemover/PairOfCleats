import { decodeEmbeddingsCache } from '../../../../src/shared/embeddings-cache/index.js';
import { createBoundedWriterQueue } from '../writer-queue.js';
import { readCacheEntry, resolveCacheShardPath } from '../cache.js';
import { withEmbeddingProfileAccess } from './profile-access.js';
import { withContainedFile } from '../../../../src/shared/contained-file.js';

/** Read a batch with one open/stat per shard and bounded coalesced ranges. */
export const readCacheEntries = (cacheDir, cacheKeys, cacheIndex = null, options = {}) => withEmbeddingProfileAccess(cacheDir,
  () => readCacheEntriesUnlocked(cacheDir, cacheKeys, cacheIndex, options));
const readCacheEntriesUnlocked = async (cacheDir, cacheKeys, cacheIndex = null, {
  maxReadBytes = 8 * 1024 * 1024, maxEntryBytes = maxReadBytes, fallbacks = [], allowUnindexedStandalone = false
} = {}) => {
  if (!Number.isSafeInteger(maxReadBytes) || maxReadBytes < 12 || maxReadBytes > 64 * 1024 * 1024
    || !Number.isSafeInteger(maxEntryBytes) || maxEntryBytes < 12 || maxEntryBytes > maxReadBytes) throw new TypeError('Invalid cache read byte reservation.');
  const results = new Map();
  const groups = new Map();
  for (const key of [...new Set(cacheKeys)]) {
    const physicalKey = cacheIndex?.chunkInputs?.[key] || key;
    const pointer = cacheIndex?.entries?.[physicalKey];
    if (cacheIndex && !pointer && !allowUnindexedStandalone) { results.set(key,{path:null,entry:null}); continue; }
    if (!pointer?.shard) {
      results.set(key, await readCacheEntry(cacheDir, physicalKey, cacheIndex, { maxBytes: maxEntryBytes }));
      continue;
    }
    const shardPath = resolveCacheShardPath(cacheDir, pointer.shard);
    const length = Number(pointer.length), offset = Number(pointer.offset);
    if (!shardPath || !Number.isSafeInteger(length) || length <= 0 || length > maxEntryBytes
      || !Number.isSafeInteger(offset) || offset < 0) {
      results.set(key, {path:null,entry:null});
      continue;
    }
    const group = groups.get(shardPath) || [];
    group.push({key,physicalKey,pointer,length,offset});
    groups.set(shardPath,group);
  }
  for (const [shardPath, requests] of groups) {
    try {
      await withContainedFile(cacheDir, shardPath, async handle => {
        const stat = await handle.stat();
        requests.sort((a,b)=>a.offset-b.offset || a.key.localeCompare(b.key));
        for(let cursor=0;cursor<requests.length;){
          const first=requests[cursor], start=first.offset;
          let end=start+first.length, stop=cursor+1;
          while(stop<requests.length && requests[stop].offset+requests[stop].length-start<=maxReadBytes) {
            end=Math.max(end,requests[stop].offset+requests[stop].length);stop++;
          }
          if(end>stat.size){for(const request of requests.slice(cursor,stop))results.set(request.key,{path:shardPath,entry:null});cursor=stop;continue;}
          const buffer=Buffer.alloc(end-start);let read=0;
          while(read<buffer.length){const part=await handle.read(buffer,read,buffer.length-read,start+read);if(!part.bytesRead)break;read+=part.bytesRead;}
          for(const request of requests.slice(cursor,stop)){
            let entry=null;
            if(read===buffer.length){try{entry=await decodeEmbeddingsCache(buffer.subarray(request.offset-start,request.offset-start+request.length), { maxBytes: maxEntryBytes });}catch{}}
            if (entry && entry.key !== request.physicalKey) entry = null;
            results.set(request.key,{path:shardPath,entry,indexEntry:request.pointer});
          }
          cursor=stop;
        }
        handle.verify();
      });
    }catch(error){
      if (error.cacheOwnershipPending || error instanceof AggregateError) throw error;
      for(const request of requests)results.set(request.key,{path:shardPath,entry:null});
    }
  }
  for (const fallback of fallbacks) {
    const missing = [...new Set(cacheKeys)].filter(key => !results.get(key)?.entry);
    if (!missing.length) break;
    const values = await readCacheEntries(fallback.cacheDir, missing, fallback.cacheIndex,
      { maxReadBytes, maxEntryBytes, allowUnindexedStandalone: fallback.allowUnindexedStandalone === true });
    missing.forEach((key, index) => { if (values[index]?.entry) results.set(key, values[index]); });
  }
  return cacheKeys.map(key=>results.get(key)||{path:null,entry:null});
};

/** Coalesce live per-file cache lookups within a bounded dispatcher window. */
export const createCacheBatchReader = ({cacheDir,cacheIndex,scheduleIo,maxPending=32,
  maxPendingBytes=64*1024*1024,maxWaitMs=2,fallbacks=[],hydrateEntry=null}={}) => {
  const admission=createBoundedWriterQueue({maxPending,maxPendingBytes});
  const hydration = createBoundedWriterQueue({ maxPending: Math.min(4, maxPending), maxPendingBytes });
  const hydrate = async entry => {
    if (!hydrateEntry || !entry?.chunkReferences) return hydrateEntry ? hydrateEntry(entry) : entry;
    const bytes = entry.chunkReferences.records?.reduce((sum, ref) => sum
      + ['code', 'doc', 'merged'].reduce((part, channel) => part + (Number(ref.channels?.[channel]) || 0), 0), 0);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxPendingBytes) return null;
    return new Promise((resolve, reject) => {
      void hydration.enqueue(async () => {
        try { resolve(await hydrateEntry(entry)); } catch (error) { reject(error); }
      }, { bytes }).catch(reject);
    });
  };
  let pending=[],timer=null,flushing=null;
  const flush=async()=>{
    if(flushing)return flushing;
    if(timer){clearTimeout(timer);timer=null;}
    const requests=pending;pending=[];
    if(!requests.length)return;
    flushing=(async()=>{
      try{
        const run=()=>readCacheEntries(cacheDir,requests.map(request=>request.key),cacheIndex,{fallbacks});
        const results=scheduleIo?await scheduleIo(run):await run();
        for (let index = 0; index < results.length; index++) {
          const result = results[index];
          if (hydrateEntry && result.entry) result.entry = await hydrate(result.entry);
          requests[index].resolve(result);
          // Hand completed buffers to the caller immediately; the dispatcher
          // must not retain every expanded file until the batch finishes.
          results[index] = null;
        }
      }catch(error){requests.forEach(request=>request.reject(error));}
    })().finally(()=>{
      flushing=null;
      if(pending.length)timer=setTimeout(()=>{void flush();},maxWaitMs);
    });
    return flushing;
  };
  return {
    async read(key){
      const length=Number(cacheIndex?.entries?.[cacheIndex?.chunkInputs?.[key] || key]?.length
        ?? fallbacks.find(fallback=>fallback.cacheIndex?.entries?.[key])?.cacheIndex.entries[key].length)||0;
      if(length>8*1024*1024)return {path:null,entry:null};
      let resolve,reject;
      const result=new Promise((done,fail)=>{resolve=done;reject=fail;});
      await admission.enqueue(()=>{
        pending.push({key,resolve,reject});
        if(pending.length>=maxPending)void flush();
        else if(!timer&&!flushing)timer=setTimeout(()=>{void flush();},maxWaitMs);
        return result;
      },{bytes:length});
      return result;
    },
    async drain(){await flush();await admission.onIdle();await hydration.onIdle();},
    stats:()=>({...admission.stats(),hydration:hydration.stats()})
  };
};

