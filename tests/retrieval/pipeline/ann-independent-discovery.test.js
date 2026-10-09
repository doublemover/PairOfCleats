#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { parseQueryInput, annotateQueryAst } from '../../../src/retrieval/query.js';
import { createAvailableDenseAnnProvider, createInMemorySearchPipeline } from './helpers/in-memory-search-pipeline-fixture.js';
applyTestEnv();
const chunks = Array.from({length: 180}, (_,id)=>({id,file:'src/'+id+'.js',tokens:id===179?['semantic','refresh']:['cache','refresh'],phraseTokens:id===178?['refresh','cache']:['cache','refresh'],weight:1}));
const index={chunkMeta:chunks,tokenIndex:{vocab:['cache','refresh','semantic'],postings:[chunks.slice(0,179).map(c=>[c.id,1]),chunks.map(c=>[c.id,1]),[[179,1]]],docLengths:chunks.map(()=>2),totalDocs:180,avgDocLen:2},denseVec:{vectors:chunks.map(()=>[0.1,0.2])}};
let observed;
const provider=createAvailableDenseAnnProvider(async ({candidateSet,topN})=>{
  observed=candidateSet;
  return [179,178,177].filter(id=>!candidateSet||candidateSet.has(id)).slice(0,topN).map((idx,i)=>({idx,sim:0.99-i*0.01}));
});
const execute=async (query,overrides={})=>{
  const ast=annotateQueryAst(parseQueryInput(query).ast,new Set(),{},{});
  const pipeline=createInMemorySearchPipeline({provider,query,queryTokens:['cache'],topN:1,maxCandidates:200,annCandidateCap:200,annCandidateMaxDocCount:200,overrides:{queryAst:ast,annAdaptiveProviders:true,...overrides}});
  return pipeline(index,'code',[0.1,0.2]);
};
assert.equal((await execute('cache'))[0].id,179,'hybrid discovers a semantic hit outside lexical candidates');
assert.equal(observed,null,'unconstrained discovery searches the full vector corpus');
await execute('cache',{annDiscovery:'lexical-rerank',annAdaptiveProviders:false});
assert.ok(observed instanceof Set && !observed.has(179),'explicit lexical reranking restricts candidates');
assert.equal((await execute('"cache refresh"'))[0].id,179,'literal tokens, rather than scoring tokens, define quote eligibility');
assert.ok(observed.has(179)&&!observed.has(178),'phrase gate applies before vector top-N');
chunks[179].phraseTokens=['semantic','refresh'];
assert.equal((await execute('"cache refresh"'))[0].id,177);
assert.equal((await execute('cache NOT semantic'))[0].id,178);
assert.ok(!observed.has(179),'exclusion gates precede vector top-N');
assert.equal((await execute('cache AND refresh'))[0].id,178);
assert.ok(!observed.has(179),'explicit Boolean gates precede vector top-N');
console.log('independent ANN discovery and pre-cap hard eligibility passed');
