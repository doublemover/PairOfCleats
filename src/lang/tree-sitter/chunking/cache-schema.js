import { TREE_SITTER_CHUNK_VERSION } from '../config.js';

export const CHUNK_CACHE_PERSISTENT_SCHEMA = '2.0.0';
export const CHUNK_CACHE_LIMITS = Object.freeze({maxEntryBytes:8*1024*1024,maxRetainedBytes:32*1024*1024,
  maxRows:20000,maxDepth:32,maxValues:250000});
export const chunkCacheLimits = input => {
  const result={...CHUNK_CACHE_LIMITS,...input};
  for(const [key,value] of Object.entries(result)) if(!Object.hasOwn(CHUNK_CACHE_LIMITS,key)
    || !Number.isSafeInteger(value)||value<1||value>CHUNK_CACHE_LIMITS[key]) throw new TypeError('Invalid private chunk-cache bound.');
  return result;
};
const record = value => value && typeof value==='object'&&!Array.isArray(value)
  && [Object.prototype,null].includes(Object.getPrototypeOf(value));
/** JSON data only, bounded before clone/stringification. Excess products remain
 * supported source; they simply bypass this disposable representation. */
export const admitChunkCacheRows = (chunks,sourceLength,limits=CHUNK_CACHE_LIMITS) => {
  if(!Number.isSafeInteger(sourceLength)||sourceLength<0||!Array.isArray(chunks)||!chunks.length||chunks.length>limits.maxRows) return null;
  for(const row of chunks) {
    if(!record(row))return null;
    const data=Object.getOwnPropertyDescriptors(row);
    if(Object.values(data).some(field=>!Object.hasOwn(field,'value')))return null;
    const start=data.start?.value,end=data.end?.value,kind=data.kind?.value,name=data.name?.value,meta=data.meta?.value;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>sourceLength
      ||typeof kind!=='string'||!kind||kind.length>256||typeof name!=='string'||name.length>65536
      ||meta!==undefined&&!record(meta))return null;
    if(meta){
      const fields=Object.getOwnPropertyDescriptors(meta);
      if(Object.values(fields).some(field=>!Object.hasOwn(field,'value')))return null;
      for(const key of ['startLine','endLine'])if(meta[key]!==undefined&&(!Number.isSafeInteger(meta[key])||meta[key]<1))return null;
      for(const key of ['signature','docstring','parserCoverage','syntaxCallCoverage'])if(meta[key]!=null&&typeof meta[key]!=='string')return null;
      for(const key of ['definitionStart','definitionEnd','bodyStart','bodyEnd'])if(meta[key]!=null
        &&(!Number.isSafeInteger(meta[key])||meta[key]<0||meta[key]>sourceLength))return null;
      if(meta.bodyStart!=null&&meta.bodyEnd!=null&&meta.bodyEnd<meta.bodyStart)return null;
      if(meta.params!==undefined&&!Array.isArray(meta.params))return null;
      if(meta.syntaxCalls!==undefined&&(!Array.isArray(meta.syntaxCalls)||meta.syntaxCalls.some(call=>!record(call)
        ||typeof call.caller!=='string'||call.callee!==null&&typeof call.callee!=='string'
        ||!Number.isSafeInteger(call.start)||!Number.isSafeInteger(call.end)||call.start<0||call.end<call.start||call.end>sourceLength)))return null;
    }
  }
  const stack=[{value:chunks,depth:0}]; let values=0,stringBytes=0;
  while(stack.length) {
    const {value,depth}=stack.pop();
    if(++values>limits.maxValues||depth>limits.maxDepth) return null;
    if(typeof value==='string') {stringBytes+=Buffer.byteLength(value);if(stringBytes>limits.maxEntryBytes)return null;}
    else if(typeof value==='number') {if(!Number.isFinite(value))return null;}
    else if(value!==null&&value!==undefined&&typeof value!=='boolean') {
      if(!Array.isArray(value)&&!record(value))return null;
      if(Array.isArray(value)&&value.length>limits.maxValues)return null;
      const descriptors=Object.getOwnPropertyDescriptors(value);
      if(Object.keys(descriptors).length+values+stack.length>limits.maxValues)return null;
      for(const [key,descriptor]of Object.entries(descriptors)) {
        if(Array.isArray(value)&&key==='length')continue;
        if(!Object.hasOwn(descriptor,'value'))return null;
        stringBytes+=Buffer.byteLength(key);if(stringBytes>limits.maxEntryBytes)return null;
        stack.push({value:descriptor.value,depth:depth+1});
      }
    }
  }
  const encoded=JSON.stringify(chunks),bytes=Buffer.byteLength(encoded);
  if(bytes>limits.maxEntryBytes)return null;
  return {bytes,retainedBytes:bytes*2+values*64,encoded};
};
export const createChunkCachePayload = (key,chunks,sourceLength) => ({schemaVersion:CHUNK_CACHE_PERSISTENT_SCHEMA,
  cacheKey:key,producerVersion:TREE_SITTER_CHUNK_VERSION,source:{length:sourceLength,encoding:'utf16le-js-string'},chunks});
export const admitChunkCachePayload = (payload,key,sourceLength,limits) => record(payload)
  &&payload.schemaVersion===CHUNK_CACHE_PERSISTENT_SCHEMA&&payload.cacheKey===key
  &&payload.producerVersion===TREE_SITTER_CHUNK_VERSION&&payload.source?.length===sourceLength
  &&payload.source.encoding==='utf16le-js-string' ? admitChunkCacheRows(payload.chunks,sourceLength,limits) : null;
