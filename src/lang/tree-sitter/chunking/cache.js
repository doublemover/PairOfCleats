import { withGeneratedCacheMetadata } from '../../../shared/generated-artifact-cache.js';
import fs from 'node:fs';
import path from 'node:path';
import { buildLocalCacheKey } from '../../../shared/cache-key.js';
import { atomicWriteJsonSync } from '../../../shared/io/atomic-write.js';
import { treeSitterState } from '../state.js';
import { TREE_SITTER_CHUNK_VERSION } from '../config.js';
import { createHash } from 'node:crypto';
import { assertNoSymlinkPath, readVerifiedContainedFileSync } from '../../../shared/contained-file.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { admitChunkCacheRows, admitChunkCachePayload, createChunkCachePayload, chunkCacheLimits, CHUNK_CACHE_PERSISTENT_SCHEMA } from './cache-schema.js';
import { SYNTAX_CALL_FACTS_VERSION } from '../call-facts.js';
import { NATIVE_FLOW_FACTS_VERSION, MANAGED_NATIVE_FLOW_LANGUAGES } from '../flow-facts.js';

const DEFAULT_CHUNK_CACHE_MAX_ENTRIES = 64;


const trimCacheEntries = (cache, maxEntries) => {
  while (cache?.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
};

const trimPersistentMemo = (maxEntries = treeSitterState.chunkCacheMaxEntries || DEFAULT_CHUNK_CACHE_MAX_ENTRIES) => {
  trimCacheEntries(treeSitterState.persistentChunkCacheMemo, maxEntries);
  trimCacheEntries(treeSitterState.persistentChunkCacheMisses, maxEntries);
};

const rememberPersistentMiss = (key) => {
  const misses = treeSitterState.persistentChunkCacheMisses;
  misses?.delete?.(key);
  misses?.add?.(key);
  trimPersistentMemo();
};

/**
 * Build stable cache signature from tree-sitter chunking controls.
 * @param {object} options
 * @param {string} resolvedId
 * @returns {object}
 */
const buildChunkCacheSignature = (options, resolvedId) => {
  const config = options?.treeSitter || {};
  const perLanguage = config.byLanguage?.[resolvedId] || {};
  const adaptiveRaw = config.adaptive;
  const adaptive = adaptiveRaw === false || adaptiveRaw?.enabled === false
    ? false
    : adaptiveRaw && typeof adaptiveRaw === 'object'
      ? {
        denseThreshold: adaptiveRaw.denseThreshold ?? null,
        denserThreshold: adaptiveRaw.denserThreshold ?? null,
        denseScale: adaptiveRaw.denseScale ?? null,
        denserScale: adaptiveRaw.denserScale ?? null
      }
      : null;

  return {
    syntaxCallFactsVersion: SYNTAX_CALL_FACTS_VERSION,
    ...(MANAGED_NATIVE_FLOW_LANGUAGES.has(resolvedId) ? { nativeFlowFactsVersion: NATIVE_FLOW_FACTS_VERSION } : {}),
    useQueries: config.useQueries ?? null,
    maxBytes: perLanguage.maxBytes ?? config.maxBytes ?? null,
    maxLines: perLanguage.maxLines ?? config.maxLines ?? null,
    maxParseMs: perLanguage.maxParseMs ?? config.maxParseMs ?? null,
    maxAstNodes: perLanguage.maxAstNodes ?? config.maxAstNodes ?? null,
    maxAstStack: perLanguage.maxAstStack ?? config.maxAstStack ?? null,
    maxChunkNodes: perLanguage.maxChunkNodes ?? config.maxChunkNodes ?? null,
    adaptive,
    configChunking: config.configChunking === true
  };
};

/**
 * Resolve in-memory/persistent cache key for one language + config signature.
 * @param {object} options
 * @param {string} resolvedId
 * @returns {string|null}
 */
export const resolveChunkCacheKey = (options, resolvedId) => {
  if (options?.treeSitter?.chunkCache === false) return null;
  const rawKey = options?.treeSitterCacheKey ?? options?.treeSitter?.cacheKey ?? null;
  if (rawKey == null || rawKey === '') return null;
  const base = typeof rawKey === 'string' ? rawKey : String(rawKey);
  if (!base) return null;
  return buildLocalCacheKey({
    namespace: 'tree-sitter-chunk',
    payload: {
      producerVersion: TREE_SITTER_CHUNK_VERSION,
      languageId: resolvedId,
      key: base,
      signature: buildChunkCacheSignature(options, resolvedId)
    }
  }).key;
};

/**
 * Resolve maximum number of LRU chunk entries.
 * @param {object} options
 * @returns {number}
 */
const resolveChunkCacheMaxEntries = (options) => {
  const raw = options?.treeSitter?.chunkCacheMaxEntries
    ?? options?.treeSitter?.chunkCache?.maxEntries
    ?? DEFAULT_CHUNK_CACHE_MAX_ENTRIES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CHUNK_CACHE_MAX_ENTRIES;
  return Math.max(1, Math.floor(parsed));
};

/**
 * Ensure process-local chunk cache map with configured capacity.
 * @param {object} options
 * @returns {{cache:Map<string,Array<object>>,maxEntries:number}}
 */
export const ensureChunkCache = (options) => {
  const maxEntries = resolveChunkCacheMaxEntries(options);
  if (!treeSitterState.chunkCache) treeSitterState.chunkCache = new Map();
  if (treeSitterState.chunkCacheMaxEntries !== maxEntries) {
    treeSitterState.chunkCache.clear();
    treeSitterState.chunkCacheMaxEntries = maxEntries;
    trimPersistentMemo(maxEntries);
  }
  return { cache: treeSitterState.chunkCache, maxEntries };
};

/**
 * Reset persistent cache memoization state when cache root changes.
 * @param {string|null} cacheRoot
 * @returns {string|null}
 */
const ensurePersistentChunkCacheRoot = (cacheRoot) => {
  if (!cacheRoot || typeof cacheRoot !== 'string') return null;
  if (treeSitterState.persistentChunkCacheRoot === cacheRoot) return cacheRoot;
  treeSitterState.persistentChunkCacheRoot = cacheRoot;
  treeSitterState.persistentChunkCacheMemo?.clear();
  treeSitterState.persistentChunkCacheMemo = new Map();
  treeSitterState.persistentChunkCacheMisses = new Set();
  return cacheRoot;
};

/**
 * Resolve persistent cache root directory when enabled.
 * @param {object} options
 * @returns {string|null}
 */
export const resolvePersistentChunkCacheRoot = (options) => {
  const cfg = options?.treeSitter || {};
  if (cfg.cachePersistent !== true) return null;
  const dir = typeof cfg.cachePersistentDir === 'string'
    ? cfg.cachePersistentDir.trim()
    : '';
  if (!dir) return null;
  return ensurePersistentChunkCacheRoot(path.resolve(dir));
};

/**
 * Resolve deterministic sharded file path for one persistent cache key.
 * @param {string|null} cacheRoot
 * @param {string} key
 * @returns {string|null}
 */
export const resolvePersistentChunkCachePaths = (cacheRoot, key) => {
  if (!cacheRoot || !key) return null;
  const safeKey = String(key).replace(/[^a-zA-Z0-9._-]/g, '_');
  const shard = createHash('sha256').update(String(key)).digest('hex').slice(0, 2);
  return { canonical: path.join(cacheRoot, shard, `${safeKey}.json`),
    legacy: path.join(cacheRoot, safeKey.slice(0, 2) || '00', `${safeKey}.json`) };
};

const retained = new Map(), tokens = new WeakMap(), blockers = new Map();
const ownedRows=new WeakMap();
const admitRows=(rows,sourceLength,limits)=>{
  const proof=ownedRows.get(rows),policy=JSON.stringify(limits);
  return proof?.sourceLength===sourceLength&&proof.policy===policy?proof.admitted:admitChunkCacheRows(rows,sourceLength,limits);
};
const ownedCopy=(rows,sourceLength,limits,admitted)=>{
  const copy=structuredClone(rows),stack=[copy];
  while(stack.length){const value=stack.pop();if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))stack.push(child);Object.freeze(value);
  }}
  ownedRows.set(copy,{sourceLength,policy:JSON.stringify(limits),admitted});return copy;
};
let retainedBytes=0;
const metric=(bump,key,value=1)=>{if(typeof bump==='function')bump(key,value);};
const pruneRetained=()=>{for(const [token,row]of retained)if(!row.cache.has(row.key)) {retainedBytes-=row.bytes;retained.delete(token);tokens.get(row.cache)?.delete(row.key);}};
const forget=(cache,key)=>{cache?.delete(key);pruneRetained();};
const retain=(cache,key,value,bytes,maxEntries,limits,bump)=>{
  forget(cache,key);cache.set(key,value);
  let map=tokens.get(cache);if(!map){map=new Map();tokens.set(cache,map);}
  const token={};map.set(key,token);retained.set(token,{cache,key,bytes});retainedBytes+=bytes;
  while(cache.size>maxEntries)forget(cache,cache.keys().next().value);
  while(retainedBytes>limits.maxRetainedBytes&&retained.size) {
    const row=retained.values().next().value;forget(row.cache,row.key);metric(bump,'chunkCacheByteEvictions');
  }
};
const touch=(cache,key)=>{
  const token=tokens.get(cache)?.get(key),row=retained.get(token);
  if(row){retained.delete(token);retained.set(token,row);}
  const value=cache.get(key);cache.delete(key);cache.set(key,value);return value;
};
export const chunkCacheRetentionObservation=()=>{pruneRetained();return {retainedBytes,retainedCopies:retained.size,
  scope:'one-JavaScript-isolate;worker-multiplication-unobserved',
  accounting:'UTF8-serialized-bytes-times-two-plus64-per-value;both-independent-cache-copies-charged'};};
const checkBlocker=scope=>{
  const error=blockers.get(scope);if(!error)return;
  observeStorageResource(error,{phase:'tree-sitter-cache-prior-resource'}).requireSettled();blockers.delete(scope);
};
const recover=(error,scope,bump,field='chunkCachePersistentErrors')=>{
  try{observeStorageResource(error,{phase:'tree-sitter-cache-resource'}).requireSettled();}
  catch(pending){blockers.set(scope,pending);throw pending;}
  if(!(error instanceof SyntaxError)&&!['ENOENT','ENOTDIR','EACCES','EPERM','EISDIR','ERR_UNSAFE_FILE_PATH',
    'ERR_FILE_TOO_LARGE','ERR_FILE_CHANGED','ERR_FILE_INTEGRITY','ERR_CHUNK_CACHE_SCHEMA'].includes(error.code))throw error;
  metric(bump,field);
  metric(bump,error.code==='ERR_FILE_TOO_LARGE'?'chunkCacheOversizeMisses':error.code==='ENOENT'?'chunkCacheAbsentMisses':'chunkCacheRejectedMisses');
};
const readPayload=(root,file,key,sourceLength,limits,bump)=>{
  const result=readVerifiedContainedFileSync(root,file,{maxBytes:limits.maxEntryBytes});
  metric(bump,'chunkCacheReadBytes',result.buffer.byteLength);
  const payload=JSON.parse(result.buffer.toString('utf8'));
  metric(bump,'chunkCacheDecodedBytes',result.buffer.byteLength);
  const admitted=admitChunkCachePayload(payload,key,sourceLength,limits);
  if(!admitted)throw Object.assign(new Error('Persistent chunk-cache source/schema admission failed.'),{code:'ERR_CHUNK_CACHE_SCHEMA'});
  return {payload,admitted,identity:result.fileIdentity};
};
const retireLegacy=(root,paths,key,chunks,sourceLength,limits,bump)=>{
  if(paths.canonical===paths.legacy||!fs.existsSync(paths.legacy))return;
  const old=readPayload(root,paths.legacy,key,sourceLength,limits,bump);
  if(old.admitted.encoded!==JSON.stringify(chunks))return;
  // Retirement remains conditional on the exact ordinary object just admitted.
  assertNoSymlinkPath(root,paths.legacy);
  const current=fs.lstatSync(paths.legacy,{bigint:true});
  if(!current.isFile()||current.dev.toString()!==old.identity.dev||current.ino.toString()!==old.identity.ino)return;
  fs.unlinkSync(paths.legacy);
};
const publishPayload=(root,file,payload,limits)=>{
  const wrapped=withGeneratedCacheMetadata(payload,'tree-sitter-chunks');
  if(Buffer.byteLength(JSON.stringify(wrapped))>limits.maxEntryBytes)return false;
  assertNoSymlinkPath(path.parse(path.resolve(root)).root,root,{allowMissing:true});
  fs.mkdirSync(root,{recursive:true});assertNoSymlinkPath(root,file,{allowMissing:true});
  atomicWriteJsonSync(file,wrapped,{spaces:0,newline:false,durable:false});return true;
};

/** Both tiers admit the same current source extent and portable schema. A miss
 * never certifies parser coverage; an unresolved descriptor never becomes miss. */
export const loadCachedChunks=({cache,key,cacheRoot=null,bumpMetric=null,sourceLength=null,limits:inputLimits=null})=>{
  const limits=chunkCacheLimits(inputLimits||{}),scope=JSON.stringify([cacheRoot,key]);checkBlocker(scope);pruneRetained();
  if(!Number.isSafeInteger(sourceLength)||sourceLength<0){metric(bumpMetric,'chunkCacheSourceExtentMisses');return null;}
  if(cache?.has(key)) {
    const rows=cache.get(key),admitted=admitRows(rows,sourceLength,limits);
    if(admitted&&admitted.retainedBytes<=limits.maxRetainedBytes){
      retain(cache,key,ownedRows.has(rows)?rows:ownedCopy(rows,sourceLength,limits,admitted),admitted.retainedBytes,treeSitterState.chunkCacheMaxEntries||DEFAULT_CHUNK_CACHE_MAX_ENTRIES,limits,bumpMetric);
      metric(bumpMetric,'chunkCacheHits');return structuredClone(rows);
    }
    forget(cache,key);
  }
  metric(bumpMetric,'chunkCacheMisses');if(!cacheRoot||!key)return null;
  ensurePersistentChunkCacheRoot(cacheRoot);
  const memo=treeSitterState.persistentChunkCacheMemo,misses=treeSitterState.persistentChunkCacheMisses;
  if(memo.has(key)){
    const rows=memo.get(key),admitted=admitRows(rows,sourceLength,limits);
    if(admitted&&admitted.retainedBytes<=limits.maxRetainedBytes){
      touch(memo,key);retain(cache,key,ownedCopy(rows,sourceLength,limits,admitted),admitted.retainedBytes,treeSitterState.chunkCacheMaxEntries||DEFAULT_CHUNK_CACHE_MAX_ENTRIES,limits,bumpMetric);
      metric(bumpMetric,'chunkCachePersistentHits');return structuredClone(rows);
    }
    forget(memo,key);
  }
  if(misses.has(key)){rememberPersistentMiss(key);metric(bumpMetric,'chunkCachePersistentMisses');return null;}
  const paths=resolvePersistentChunkCachePaths(cacheRoot,key);let raw=null,legacy=false;
  for(const file of [...new Set([paths.canonical,paths.legacy])]){
    try{raw=readPayload(cacheRoot,file,key,sourceLength,limits,bumpMetric);legacy=file===paths.legacy&&file!==paths.canonical;break;}
    catch(error){recover(error,scope,bumpMetric);}
  }
  if(!raw){rememberPersistentMiss(key);metric(bumpMetric,'chunkCachePersistentMisses');return null;}
  const rows=raw.payload.chunks,admitted=raw.admitted;
  if(admitted.retainedBytes>limits.maxRetainedBytes){metric(bumpMetric,'chunkCacheOversizeMisses');return null;}
  try{
    if(legacy&&!publishPayload(cacheRoot,paths.canonical,raw.payload,limits))return null;
    retireLegacy(cacheRoot,paths,key,rows,sourceLength,limits,bumpMetric);
  }catch(error){recover(error,scope,bumpMetric,'chunkCachePersistentMigrationErrors');}
  retain(memo,key,ownedCopy(rows,sourceLength,limits,admitted),admitted.retainedBytes,treeSitterState.chunkCacheMaxEntries||DEFAULT_CHUNK_CACHE_MAX_ENTRIES,limits,bumpMetric);
  retain(cache,key,ownedCopy(rows,sourceLength,limits,admitted),admitted.retainedBytes,treeSitterState.chunkCacheMaxEntries||DEFAULT_CHUNK_CACHE_MAX_ENTRIES,limits,bumpMetric);
  misses.delete(key);metric(bumpMetric,'chunkCachePersistentHits');return structuredClone(rows);
};
export const storeCachedChunks=({cache,key,chunks,maxEntries,cacheRoot=null,bumpMetric=null,sourceLength=null,limits:inputLimits=null})=>{
  if(!cache||typeof cache.set!=='function'||typeof key!=='string'||!key)return;
  const limits=chunkCacheLimits(inputLimits||{}),scope=JSON.stringify([cacheRoot,key]);checkBlocker(scope);
  const admitted=admitChunkCacheRows(chunks,sourceLength,limits);
  if(!admitted||admitted.retainedBytes>limits.maxRetainedBytes){metric(bumpMetric,'chunkCacheAdmissionSkipped');return;}
  if(cacheRoot){
    ensurePersistentChunkCacheRoot(cacheRoot);const paths=resolvePersistentChunkCachePaths(cacheRoot,key);
    try{
      const payload=createChunkCachePayload(key,structuredClone(chunks),sourceLength);
      if(publishPayload(cacheRoot,paths.canonical,payload,limits)){
        metric(bumpMetric,'chunkCachePersistentWrites');
        retain(treeSitterState.persistentChunkCacheMemo,key,ownedCopy(chunks,sourceLength,limits,admitted),admitted.retainedBytes,maxEntries,limits,bumpMetric);
        treeSitterState.persistentChunkCacheMisses.delete(key);
        try{retireLegacy(cacheRoot,paths,key,chunks,sourceLength,limits,bumpMetric);}
        catch(error){recover(error,scope,bumpMetric,'chunkCachePersistentMigrationErrors');}
      }
    }catch(error){recover(error,scope,bumpMetric);}
  }
  retain(cache,key,ownedCopy(chunks,sourceLength,limits,admitted),admitted.retainedBytes,maxEntries,limits,bumpMetric);metric(bumpMetric,'chunkCacheSets');
};

export {CHUNK_CACHE_PERSISTENT_SCHEMA};
