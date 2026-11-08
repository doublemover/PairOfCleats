import assert from 'node:assert/strict';
import { createRepoMapIterator } from '../../../src/index/build/artifacts/writers/repo-map.js';
import { buildFileMeta } from '../../../src/index/build/artifacts/file-meta.js';
import { createIndexState, mergeIndexState } from '../../../src/index/build/state.js';
import { resolveFilterIndexArtifactState } from '../../../src/index/build/artifacts/filter-index-reuse.js';
const chunks=[{file:'x::y',name:'z',kind:'k',startLine:1},{file:'x',name:'y::z',kind:'k',startLine:1}];
assert.equal([...createRepoMapIterator({chunks})()].length,2);
const base={chunks:[],discoveredFiles:['a.js'],fileInfoByPath:new Map([['a.js',{size:10,hash:'same',hashAlgo:'sha1'}]])};
const build=details=>buildFileMeta({...base,fileDetailsByPath:new Map([['a.js',details]])});
const a=build({last_author:'Alice',churn:1,externalDocs:{title:'first'}});
for(const details of [{last_author:'Bob',churn:1,externalDocs:{title:'first'}},{last_author:'Alice',churn:2,externalDocs:{title:'first'}},{last_author:'Alice',churn:1,externalDocs:{title:'second'}}]) {
  assert.notEqual(build(details).fingerprint,a.fingerprint);
}
assert.equal(build({churn:1,last_author:'Alice',externalDocs:{title:'first'}}).fingerprint,a.fingerprint);
for(const field of ['tokenIdMap','tokenIdCollisions','phrasePostHashBuckets','riskSummaries','riskFlows','riskPartialFlows','riskInterproceduralStats']) {
  const target=createIndexState();const source=createIndexState();source.chunks.push({id:0,file:'a.js'});
  source[field]=field.endsWith('Map')||field.endsWith('Buckets')?new Map([['x',1]]):field.endsWith('Stats')?{count:1}:[{value:1}];
  assert.throws(()=>mergeIndexState(target,source),error=>error.code==='ERR_INDEX_STATE_MERGE_UNSUPPORTED'&&error.field===field);
  assert.equal(target.chunks.length,0,'reject before partial merge');
}
const resolved=resolveFilterIndexArtifactState({outDir:process.cwd(),maxJsonBytes:1024,maxJsonBytesSoft:900,state:{chunks:[{id:0,file:'new.rs',lang:'rust'}]},resolvedConfig:{get chargramMinN(){throw new Error('injected current generation failure');}},userConfig:{},root:process.cwd(),log:()=>{}});
assert.equal(resolved.filterIndex,null);assert.equal(resolved.filterIndexReused,false);assert.equal(resolved.filterIndexFallback,null);
console.log('artifact identity/cache dependency regressions passed');
