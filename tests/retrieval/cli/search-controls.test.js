#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseSearchArgs } from '../../../src/retrieval/cli-args.js';
import { normalizeSearchOptions } from '../../../src/retrieval/cli/normalize-options.js';
import { applyQueryMatchPolicy, resolveSearchControls } from '../../../src/retrieval/cli/search-controls.js';
import { parseQueryInput, annotateQueryAst } from '../../../src/retrieval/query.js';
import { createQueryAstHelpers } from '../../../src/retrieval/pipeline/query-ast.js';
import { buildQueryPlanConfigSignature } from '../../../src/retrieval/query-plan-cache.js';
import { compactHit } from '../../../src/retrieval/cli/render-output.js';
import { applyOutputBudgetPolicy } from '../../../src/retrieval/output/score-breakdown.js';
const normalize=rawArgs=>normalizeSearchOptions({argv:parseSearchArgs(rawArgs),rawArgs,rootDir:process.cwd(),userConfig:{},metricsDir:null,policy:{}});
const fast=normalize(['--preset','fast','--candidates','12','alpha']);
assert.equal(fast.annEnabled,false);assert.equal(fast.maxCandidates,12);assert.equal(fast.contextExpansionEnabled,false);
const investigate=normalize(['--preset','investigate','alpha']);
assert.equal(investigate.annEnabled,true);assert.equal(investigate.contextExpansionEnabled,true);assert.equal(investigate.contextExpansionOptions.maxTotal,10);
assert.equal(normalize(['--preset','hybrid','alpha']).annDiscovery,'independent');
for(const bad of [{preset:'wrong'},{match:'wrong'},{candidates:0},{'deadline-ms':0},{'output-bytes':1}])assert.throws(()=>resolveSearchControls(bad));
const chunk={tokens:['alpha']},idx={chunkMeta:[chunk]};
const ast=annotateQueryAst(parseQueryInput('alpha beta').ast,new Set(),{},{});
for(const [policy,expected] of [['all',false],['any',true],['auto',false]]){
  const {matchesQueryAst}=createQueryAstHelpers({queryAst:applyQueryMatchPolicy(ast,policy)});
  assert.equal(matchesQueryAst(idx,0,chunk),expected);
}
assert.notEqual(buildQueryPlanConfigSignature({queryMatch:'all'}),buildQueryPlanConfigSignature({queryMatch:'any'}));
const identity={id:1,chunkUid:'uid',generationKey:'gen',file:'x',start:0,end:10,followups:['context'],actions:['references']};
assert.deepEqual(compactHit({...identity,tokens:['hidden']}),identity);
const payload={code:Array.from({length:12},(_,id)=>({...identity,id,name:'large'.repeat(80)})),prose:[],records:[],extractedProse:[],retrieval:{freshness:{generationKey:'gen'}}};
const bounded=applyOutputBudgetPolicy(payload,{totalMaxBytes:1100});
assert.ok(Buffer.byteLength(JSON.stringify(bounded))<=1100);
assert.equal(bounded.retrieval.freshness.generationKey,'gen');
assert.ok(bounded.outputBudget.omittedHits>0);
assert.equal(payload.code.length,12,'output budgeting cannot mutate the source hit array');
console.log('search presets, match policy, compact identities and packet budget passed');
