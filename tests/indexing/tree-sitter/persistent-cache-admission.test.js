import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ensureChunkCache,resolveChunkCacheKey,resolvePersistentChunkCachePaths,resolvePersistentChunkCacheRoot,
  loadCachedChunks,storeCachedChunks,chunkCacheRetentionObservation } from '../../../src/lang/tree-sitter/chunking/cache.js';
import { createChunkCachePayload,admitChunkCacheRows,CHUNK_CACHE_PERSISTENT_SCHEMA } from '../../../src/lang/tree-sitter/chunking/cache-schema.js';
import { withGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { buildTreeSitterChunks } from '../../../src/lang/tree-sitter/chunking.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const selected=process.env.PAIROFCLEATS_TEST_ID?.split('indexing/tree-sitter/persistent-cache-admission/')[1];
assert.ok(['schema-and-bytes','opened-resource','native-replay'].includes(selected));
const {dir:root}=await prepareIsolatedTestCacheDir('persistent-cache-admission-'+selected);
const options={treeSitter:{enabled:true,strict:true,adaptive:false,chunkCache:true,chunkCacheMaxEntries:2,cachePersistent:true,cachePersistentDir:root}};
resolvePersistentChunkCacheRoot(options);const {cache,maxEntries}=ensureChunkCache(options),sourceLength=64;
const key=resolveChunkCacheKey({...options,treeSitterCacheKey:'source'},'javascript'),paths=resolvePersistentChunkCachePaths(root,key);
const rows=[{start:0,end:16,name:'f',kind:'FunctionDeclaration',meta:{nested:{values:['original']}}}];
const clear=()=>{cache.clear();treeSitterState.persistentChunkCacheMemo.clear();treeSitterState.persistentChunkCacheMisses.clear();};
const write=(file,payload)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(payload));};
const load=extra=>loadCachedChunks({cache,key,cacheRoot:root,sourceLength,...extra});
const payload=()=>createChunkCachePayload(key,structuredClone(rows),sourceLength);
if(selected==='schema-and-bytes') {
  assert.equal(CHUNK_CACHE_PERSISTENT_SCHEMA,'2.0.0');
  storeCachedChunks({cache,key,chunks:rows,maxEntries,cacheRoot:root,sourceLength});clear();assert.deepEqual(load(),rows);
  const hit=load();hit[0].meta.nested.values[0]='caller mutation';assert.equal(load()[0].meta.nested.values[0],'original');
  const invalid=[p=>p.cacheKey='wrong',p=>p.schemaVersion='1.0.0',p=>p.producerVersion='16',p=>p.source.length++,
    p=>p.chunks[0].start=-1,p=>p.chunks[0].end=0,p=>p.chunks[0].end=65,p=>p.chunks[0].start=0.5,
    p=>p.chunks[0].kind=42,p=>delete p.chunks[0].name,p=>p.chunks[0].meta=[],p=>p.chunks[0].meta.syntaxCalls=42,
    p=>p.chunks[0].meta.bodyStart=-1,p=>p.chunks[0].meta.startLine=1.5];
  for(const mutate of invalid){const bad=payload();mutate(bad);write(paths.canonical,bad);clear();assert.equal(load(),null);assert.equal(cache.size,0);}
  const valid=withGeneratedCacheMetadata(payload(),'tree-sitter-chunks'),bytes=Buffer.byteLength(JSON.stringify(valid));
  write(paths.canonical,valid);clear();assert.deepEqual(load({limits:{maxEntryBytes:bytes}}),rows,'exact byte boundary');
  let reads=0;const originalRead=fs.readSync;fs.readSync=function(...args){reads++;return originalRead.apply(this,args);};
  try{clear();assert.equal(load({limits:{maxEntryBytes:bytes-1}}),null);assert.equal(reads,0,'oversize rejected before payload read or decode');}
  finally{fs.readSync=originalRead;}
  write(paths.legacy,payload());write(paths.canonical,{broken:true});clear();assert.deepEqual(load(),rows);assert.equal(fs.existsSync(paths.legacy),false);
  write(paths.legacy,{schemaVersion:'1.0.0',cacheKey:key,chunks:rows});fs.unlinkSync(paths.canonical);clear();
  assert.equal(load(),null);assert.equal(fs.existsSync(paths.canonical),false,'unvalidated legacy never migrates');
  const weight=admitChunkCacheRows(rows,sourceLength).retainedBytes,limits={maxRetainedBytes:weight*2-1};
  clear();storeCachedChunks({cache,key,chunks:rows,maxEntries,cacheRoot:root,sourceLength,limits});
  assert.ok(chunkCacheRetentionObservation().retainedBytes<=limits.maxRetainedBytes,'both duplicate tiers share one charged byte budget');
  for(let index=0;index<5;index++)storeCachedChunks({cache,key:key+index,chunks:rows,maxEntries,sourceLength,limits});
  assert.ok(cache.size<=2);assert.ok(chunkCacheRetentionObservation().retainedBytes<=limits.maxRetainedBytes);
} else if(selected==='opened-resource') {
  const original={open:fs.openSync,read:fs.readSync,close:fs.closeSync,lstat:fs.lstatSync,stat:fs.statSync};
  let activeFd=null,mode='short',reads=0,opens=0;
  fs.openSync=function(file,...args){const fd=original.open.call(this,file,...args);if(path.resolve(String(file))===paths.canonical){activeFd=fd;opens++;}return fd;};
  fs.readSync=function(fd,...args){if(fd===activeFd){reads++;if(mode==='short')return 0;
    const value=original.read.call(this,fd,...args);if(mode==='growth'){mode='grown';fs.appendFileSync(paths.canonical,' ');}return value;}return original.read.call(this,fd,...args);};
  fs.lstatSync=function(file,...args){const stat=original.lstat.call(this,file,...args);
    return mode==='reparse'&&path.resolve(String(file))===paths.canonical?new Proxy(stat,{get:(v,k)=>k==='isSymbolicLink'?()=>true:Reflect.get(v,k)}):stat;};
  fs.statSync=function(file,...args){const stat=original.stat.call(this,file,...args);
    return mode==='identity'&&reads>0&&path.resolve(String(file))===paths.canonical
      ?new Proxy(stat,{get:(v,k)=>k==='ino'?v.ino+(typeof v.ino==='bigint'?1n:1):Reflect.get(v,k)}):stat;};
  try{
    for(const fault of ['short','growth','identity','reparse']){mode=fault;reads=0;write(paths.canonical,payload());clear();const before=opens;assert.equal(load(),null);
      if(fault==='reparse')assert.equal(opens,before,'actual no-follow authority rejects injected reparse kind before open');}
  }finally{fs.openSync=original.open;fs.readSync=original.read;fs.closeSync=original.close;fs.lstatSync=original.lstat;fs.statSync=original.stat;}
  const childRoot=path.join(root,'unknown-close-child');fs.mkdirSync(childRoot);
  const identity=fs.lstatSync(childRoot,{bigint:true});
  const result=await spawnSubprocess(process.execPath,['tests/fixtures/workers/persistent-cache-unknown-close.js',childRoot],
    {timeoutMs:10000,maxOutputBytes:65536,captureStdout:true,captureStderr:true,rejectOnNonZeroExit:false});
  assert.equal(result.exitCode,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{pending:true,descriptorCloseAttempts:1,opens:1,boundary:'real-child-exit-required'});
  const after=fs.lstatSync(childRoot,{bigint:true});
  assert.ok(!after.isSymbolicLink()&&after.isDirectory()&&after.dev===identity.dev&&after.ino===identity.ino);
  assert.equal(path.dirname(childRoot),root);
  fs.rmSync(childRoot,{recursive:true,force:false}); // Only after confirmed actual child exit.
} else {
  const text='export function actual(value) { return work(value); }\n';
  const request={languageId:'javascript',text,options:{...options,treeSitterCacheKey:'actual-source'}};
  const fresh=buildTreeSitterChunks(request);assert.ok(fresh?.some(c=>c.name==='actual'));clear();
  const hitsBefore=treeSitterState.metrics.chunkCachePersistentHits;
  const warm=buildTreeSitterChunks(request);assert.deepEqual(warm,fresh,'actual validated disk replay preserves semantic fields');
  assert.ok(treeSitterState.metrics.chunkCachePersistentHits>hitsBefore,'actual producer must consume validated persistent rows');
  const actualKey=resolveChunkCacheKey(request.options,'javascript'),actualPaths=resolvePersistentChunkCachePaths(root,actualKey);
  write(actualPaths.canonical,{schemaVersion:'2.0.0',cacheKey:actualKey,chunks:[{start:-1,end:-5,kind:42}]});clear();
  const recovered=buildTreeSitterChunks(request);assert.deepEqual(recovered,fresh,'corrupt disposable rows return to actual fresh native production');
}
console.log('Persistent chunk-cache '+selected+' retains current source admission and original opened-resource authority.');
