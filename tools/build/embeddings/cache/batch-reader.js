import fs from 'node:fs/promises';
import { decodeEmbeddingsCache } from '../../../../src/shared/embeddings-cache/index.js';
import { createBoundedWriterQueue } from '../writer-queue.js';
import { readCacheEntry, resolveCacheShardPath } from '../cache.js';

/** Read a batch with one open/stat per shard and bounded coalesced ranges. */
export const readCacheEntries = async (cacheDir, cacheKeys, cacheIndex = null, {
  maxReadBytes = 8 * 1024 * 1024, maxEntryBytes = maxReadBytes
} = {}) => {
  const results = new Map();
  const groups = new Map();
  for (const key of [...new Set(cacheKeys)]) {
    const pointer = cacheIndex?.entries?.[key];
    if (cacheIndex && !pointer) { results.set(key,{path:null,entry:null}); continue; }
    if (!pointer?.shard) {
      results.set(key, await readCacheEntry(cacheDir, key, cacheIndex));
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
    group.push({key,pointer,length,offset});
    groups.set(shardPath,group);
  }
  for (const [shardPath, requests] of groups) {
    let handle;
    try {
      if(await fs.realpath(shardPath)!==shardPath)throw Error('Noncanonical cache shard');
      handle = await fs.open(shardPath,'r');
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
          if(read===buffer.length){try{entry=await decodeEmbeddingsCache(buffer.subarray(request.offset-start,request.offset-start+request.length));}catch{}}
          results.set(request.key,{path:shardPath,entry,indexEntry:request.pointer});
        }
        cursor=stop;
      }
    }catch{for(const request of requests)results.set(request.key,{path:shardPath,entry:null});}
    finally{await handle?.close();}
  }
  return cacheKeys.map(key=>results.get(key)||{path:null,entry:null});
};

/** Coalesce live per-file cache lookups within a bounded dispatcher window. */
export const createCacheBatchReader = ({cacheDir,cacheIndex,scheduleIo,maxPending=32,
  maxPendingBytes=64*1024*1024,maxWaitMs=2}={}) => {
  const admission=createBoundedWriterQueue({maxPending,maxPendingBytes});
  let pending=[],timer=null,flushing=null;
  const flush=async()=>{
    if(flushing)return flushing;
    if(timer){clearTimeout(timer);timer=null;}
    const requests=pending;pending=[];
    if(!requests.length)return;
    flushing=(async()=>{
      try{
        const run=()=>readCacheEntries(cacheDir,requests.map(request=>request.key),cacheIndex);
        const results=scheduleIo?await scheduleIo(run):await run();
        requests.forEach((request,index)=>request.resolve(results[index]));
      }catch(error){requests.forEach(request=>request.reject(error));}
    })().finally(()=>{
      flushing=null;
      if(pending.length)timer=setTimeout(()=>{void flush();},maxWaitMs);
    });
    return flushing;
  };
  return {
    async read(key){
      const length=Number(cacheIndex?.entries?.[key]?.length)||0;
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
    async drain(){await flush();await admission.onIdle();},
    stats:()=>admission.stats()
  };
};

