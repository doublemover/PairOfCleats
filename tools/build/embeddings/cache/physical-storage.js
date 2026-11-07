import fs from 'node:fs/promises';
import path from 'node:path';
import { decodeEmbeddingsCache } from '../../../../src/shared/embeddings-cache/index.js';
import { readVerifiedContainedFile, withContainedFile } from '../../../../src/shared/contained-file.js';
import { createContainedFileResource } from '../../../../src/shared/contained-file-resource.js';
import { withStorageDirectory } from '../../../../src/shared/storage/directory.js';
import { observeStorageResource } from '../../../../src/shared/storage/failure-observation.js';

export const isOwnedStandaloneCacheFile = async (root, filename, identityKey) => {
  const { buffer } = await readVerifiedContainedFile(root, filename, { maxBytes: 16 * 1024 * 1024 });
  const payload = filename.endsWith('.json') ? JSON.parse(buffer.toString('utf8')) : await decodeEmbeddingsCache(buffer, { maxBytes: 16 * 1024 * 1024 });
  const key = path.basename(filename).replace(/\.(?:embcache\.zst|json)$/, '');
  return payload?.key === key && payload.cacheMeta?.identityKey === identityKey;
};

export const createCachePhysicalStorage = ({ resolveCacheShardPath, resolveCacheShardDir, resolveCacheEntryPath, resolveCacheIndexPath,
  resolveCacheIndexBinaryPath, allocateShard, writeCacheIndex, writeCacheBuffer }) => {
/** Compact only registered cache shards, streaming at most the selected I/O budget. */
  const compactCacheShards = async (cacheDir, cacheIndex, maxIoBytes = 128 * 1024 * 1024, summary) => {
    let copiedBytes=0, reclaimedBytes=0;
    for(const oldName of Object.keys(cacheIndex.shards || {}).sort()){
      const oldPath=resolveCacheShardPath(cacheDir,oldName);
      if(!oldPath)continue;
      let stat;try{stat=await fs.lstat(oldPath);}catch{continue;}
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||await fs.realpath(oldPath)!==oldPath)continue;
      const shardSummary = summary.shards.get(oldName);
      const live=(shardSummary?.entries || []).slice().sort((a,b)=>a.offset-b.offset);
      const liveBytes=shardSummary?.liveBytes || 0;
      if(!live.length||liveBytes>stat.size*0.75||copiedBytes+liveBytes>maxIoBytes
      ||live.some(entry=>!Number.isSafeInteger(entry.length)||entry.length<=0||entry.length>16*1024*1024
        ||!Number.isSafeInteger(entry.offset)||entry.offset<4||entry.offset+entry.length>stat.size))continue;
      const stagedIndex={...cacheIndex,shards:{...cacheIndex.shards}};
      const newName=allocateShard(stagedIndex),newPath=resolveCacheShardPath(cacheDir,newName);
      const replacements=[];let offset=0;
      await withContainedFile(cacheDir, oldPath, async input => {
        const output=await fs.open(newPath,'wx');
        const owner = createContainedFileResource({ handle: output, sync: false });
        await owner.run(async () => {
          for(const entry of live){
            const buffer=Buffer.alloc(entry.length);let read=0;
            while(read<buffer.length){const part=await input.read(buffer,read,buffer.length-read,entry.offset+read);if(!part.bytesRead)throw Error('Incomplete cache shard');read+=part.bytesRead;}
            await decodeEmbeddingsCache(buffer);
            const prefix=Buffer.alloc(4);prefix.writeUInt32LE(buffer.length);
            await writeCacheBuffer(output,prefix,offset);await writeCacheBuffer(output,buffer,offset+4);
            replacements.push({...entry,shard:newName,offset:offset+4,length:buffer.length,sizeBytes:buffer.length+4,
              path:null,storageEpoch:(cacheIndex.storageEpoch||0)+1});
            offset+=buffer.length+4;
          }
          await output.sync();
        });
        input.verify();
      });
      cacheIndex.storageEpoch=(cacheIndex.storageEpoch||0)+1;
      cacheIndex.nextShardId=stagedIndex.nextShardId;
      cacheIndex.currentShard=newName;
      cacheIndex.shards[newName]={createdAt:new Date().toISOString(),sizeBytes:offset};
      for(const entry of replacements)cacheIndex.entries[entry.key]=entry;
      delete cacheIndex.shards[oldName];
      await writeCacheIndex(cacheDir,cacheIndex);
      try{await fs.rm(oldPath);reclaimedBytes+=stat.size-offset;}catch{}
      copiedBytes+=offset;
    }
    return {copiedBytes,reclaimedBytes};
  };

  const inspectCachePhysicalStorage = async (cacheDir,cacheIndex,summary = null) => {
    const files=new Map(), visited = new Set();
    const started = Date.now(); let complete = true, entries = 0;
    const withinBudget = () => {
      if (entries >= 8192 || Date.now() - started >= 2000) complete = false;
      return complete;
    };
    const add=async (file, protectedFile=false, orphan=false)=>{
      if (!withinBudget()) return;
      if(!file)return;
      const resolved=path.resolve(file),root=path.resolve(cacheDir)+path.sep;
      if(!resolved.startsWith(root)){complete=false;return;}
      if(visited.has(resolved))return;
      visited.add(resolved); entries++;
      try{
        const stat=await fs.lstat(resolved);
        if(!stat.isFile()||stat.isSymbolicLink()||await fs.realpath(resolved)!==resolved){complete=false;return;}
        if (orphan && !await isOwnedStandaloneCacheFile(cacheDir, resolved, cacheIndex.identityKey)) { complete=false; return; }
        files.set(resolved,{path:resolved,sizeBytes:stat.size,mtimeMs:stat.mtimeMs,protected:protectedFile||stat.nlink!==1});
      }catch(error){
        observeStorageResource(error, { phase: 'embedding-cache-physical-inventory' }).requireSettled();
        if (error instanceof AggregateError) throw error;
        if (error.code!=='ENOENT') complete=false;
      }
    };
    for(const shard of Object.keys(cacheIndex.shards||{}))await add(resolveCacheShardPath(cacheDir,shard));
    if (summary) for (const filename of summary.paths.keys()) await add(filename);
    else for(const entry of Object.values(cacheIndex.entries||{}))if(!entry.shard)await add(entry.path||resolveCacheEntryPath(cacheDir,entry.key));
    for(const file of [resolveCacheIndexPath(cacheDir),resolveCacheIndexBinaryPath(cacheDir),path.join(cacheDir,'cache.index.delta'),path.join(cacheDir,'cache.meta.json')])await add(file,true);
    // Orphan shard/encoded-key files are owned by this cache; other selected files are untouched.
    for(const [dir,pattern] of [[cacheDir,/^(?:[a-f0-9]{40,64}|(?:file|global-chunk)-[A-Za-z0-9_-]{1,230})\.(?:embcache\.zst|json)$/i],
      [resolveCacheShardDir(cacheDir),/^shard-\d{5,}\.bin$/]]){
      try{
        await withStorageDirectory(dir, async directory => {
          while (withinBudget()) {
            const entry = await directory.read(); if (!entry) break; entries++;
            if(pattern.test(entry.name))await add(path.join(dir,entry.name), false, dir===cacheDir);
          }
        });
      }catch(error){
        observeStorageResource(error, { phase: 'embedding-cache-orphan-inventory' }).requireSettled();
        if (error instanceof AggregateError) throw error;
        if (error.code!=='ENOENT') complete=false;
      }
    }
    return Object.assign([...files.values()], { complete, visitedEntries: entries });
  };

  return { compactCacheShards, inspectCachePhysicalStorage };
};
