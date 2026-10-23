import { randomUUID } from 'node:crypto';
import { attachSemanticSourceReferences } from './source-references.js';
import { semanticHash, canonicalSemanticJson } from '../index/semantic/identity.js';
import { assertSemanticFind } from '../contracts/validators/semantic-find.js';
import { fingerprintSemanticOperation } from './operation-fingerprint.js';
import { throwIfAborted } from '../shared/abort.js';
import { discoverySelector, inspectDiscoveryFact } from './discovery-facts.js';
import { captureSemanticRequest } from './request-snapshot.js';
import { SEMANTIC_FIND_REQUEST_SCHEMA } from '../contracts/schemas/semantic-find.js';
const fail=(code,message)=>Object.assign(new Error(message),{code});
export const createSemanticFindService = ({maxRecords=128,maxBytes=65536,maxWorkMs=250,maxContinuations=64,ttlMs=300000}={}) => {
  const maxima={records:maxRecords,bytes:maxBytes,workMs:maxWorkMs},continuations=new Map();
  for(const [name,hard] of Object.entries({records:128,bytes:65536,workMs:250})) if(!Number.isSafeInteger(maxima[name])||maxima[name]<1||maxima[name]>hard)throw new TypeError('Invalid find limit.');
  if(!Number.isSafeInteger(maxContinuations)||maxContinuations<1||maxContinuations>4096||!Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>86400000)throw new TypeError('Invalid continuation bounds.');
  const find = async ({store,request,signal}) => {
    assertSemanticFind('request',request);throwIfAborted(signal);
    if(request.repoRoot!==store.repoRoot)throw fail('ERR_SEMANTIC_SCOPE_MISMATCH','Repository scope differs.');
    if(canonicalSemanticJson(request.generation)!==canonicalSemanticJson(store.generation))throw fail('ERR_SEMANTIC_GENERATION_MISMATCH','Generation differs.');
    const limits={...maxima,...request.limits};
    for(const name of Object.keys(maxima))if(limits[name]>maxima[name])throw fail('ERR_SEMANTIC_QUERY_LIMIT','Find limit exceeds configured maximum.');
    const key=semanticHash('semantic.find-continuation.v1',{...request,cursor:null,limits,backend:store.backend||'custom',inventory:store.cursorScope||null,storeId:store.storeId||store.repoRoot});
    let offset=0,seed;
    if(request.cursor){const saved=continuations.get(request.cursor);if(!saved||saved.key!==key||saved.expires<=Date.now())throw fail('ERR_SEMANTIC_CURSOR_EXPIRED','Restart discovery with the original generation and selector.');offset=saved.offset;seed=saved.seed;}
    const result={schemaVersion:1,generation:request.generation,status:'partial',records:[],edges:[],operands:[],ownership:[],names:[],evidenceRefs:[],matches:[],
      coverage:{extraction:[],analysis:[],response:{state:'partial',returnedCount:0}},frontier:[],cursor:null,warnings:['Structural candidates are not behavioral equivalence; types, bindings and effects require separate evidence.']};
    const deadline=performance.now()+limits.workMs;
    if(seed===undefined)seed=request.compareTo?await fingerprintSemanticOperation({store,ref:request.compareTo,signal,deadline}):null;
    let done=false,progressed=false;
    const seenCoverage=new Set();
    const selected = discoverySelector(request.selector);
    let candidates = null, candidateIndex = 0;
    while(result.records.length<limits.records && (!progressed||performance.now()<deadline)){
      let page;
      if (request.selector.target) {
        const targetPage = await store.getNeighbors(request.selector.target, 'upstream', ['callTarget', 'constructTarget'], { offset, limit: 1, signal });
        page = { ...targetPage, refs: targetPage.edges.map(edge => edge.from) };
      } else {
        if (!candidates || candidateIndex >= candidates.refs.length) {
          candidates = await store.findOperations({ field: selected.field, value: selected.value },
            { offset, limit: Math.min(32, limits.records), signal });
          candidateIndex = 0;
        }
        const ref = candidates.refs[candidateIndex++];
        page = ref ? { refs: [ref], offset: candidates.offset - candidates.refs.length + candidateIndex,
          done: candidates.done && candidateIndex === candidates.refs.length } : candidates;
      }
      if(!page.refs.length){offset=page.offset;done=page.done;progressed=true;if(done)break;continue;}
      const ref=page.refs[0],[record]=await store.getRecords([ref],['span','scope','data'],{signal});
      if(!record)throw fail('ERR_SEMANTIC_INTEGRITY','Operation index refers to an absent node.');
      // The source bucket is indexed; interval filtering is incremental under
      // the same work/cursor budget, never an unbounded whole-index scan.
      const range=request.selector.range;
      if(range&&(!record.span||record.span[0]>=range.end||record.span[1]<=range.start)){
        offset=page.offset;done=page.done;progressed=true;if(done)break;continue;
      }

      const strict=request.selector.typeExpression||request.selector.literal;
      const fact=strict?await inspectDiscoveryFact({store,record,selector:request.selector,signal,maxBytes:limits.bytes}):null;
      if(strict&&!fact){offset=page.offset;done=page.done;progressed=true;if(done)break;continue;}
      const category=request.selector.typeExpression?'type-fact':request.selector.literal?'literal-value':request.selector.target?'target-candidate':request.selector.field==='chunkUid'?'ownership-candidate':['sourcePath','sourceUnitId'].includes(request.selector.field)?'source-candidate':'structural-candidate';
      const match={ref,category,scoreMeaning:category==='target-candidate'?'Recorded compiler target candidate; inspect binding ambiguity and context.':category==='ownership-candidate'?'Recorded primary or overlapping chunk ownership; no runtime or equivalence claim.':category==='source-candidate'?'Exact retained source identity/path match; no runtime or equivalence claim.':'Exact syntax selector match; no similarity probability.',differences:[]};
      if(fact){match.fact=fact;match.scoreMeaning=category==='type-fact'?'Exact recorded type expression, selected fact source and role. No assignability or alias expansion.':'Exact parser-established scalar literal occurrence in retained source. No runtime-value completeness claim.';}
      if(seed){match.fingerprint=await fingerprintSemanticOperation({store,ref,signal,deadline});match.differences.push(!seed.hash||!match.fingerprint.hash?'comparison_unavailable':seed.hash===match.fingerprint.hash?'ordered_structure_hash_matches':'ordered_structure_hash_differs');if(!seed.complete||!match.fingerprint.complete)match.differences.push('comparison_incomplete');}
      const coverage=seenCoverage.has(ref.partitionId)?[]:await store.getCoverage([ref.partitionId],{signal});
      const previousExtraction=result.coverage.extraction.length,previousAnalysis=result.coverage.analysis.length;
      for(const row of coverage){const target=row.phase==='syntax'?result.coverage.extraction:result.coverage.analysis;if(!target.some(value=>canonicalSemanticJson(value)===canonicalSemanticJson(row)))target.push(row);}
      result.records.push(record);result.matches.push(match);
      if(Buffer.byteLength(JSON.stringify(result))+1024>limits.bytes){result.records.pop();result.matches.pop();result.coverage.extraction.length=previousExtraction;result.coverage.analysis.length=previousAnalysis;break;}
      seenCoverage.add(ref.partitionId);offset=page.offset;done=page.done;progressed=true;if(done)break;
    }
    result.coverage.response={state:done?'complete':'partial',returnedCount:result.records.length};
    // No-match scope is not certified complete by an index selector alone.
    const complete=result.coverage.extraction.length>0&&result.coverage.extraction.every(row=>row.state==='complete')&&result.coverage.analysis.length>0&&result.coverage.analysis.every(row=>row.state==='complete');
    if(!complete)result.warnings.push('Requested analysis coverage is incomplete or unavailable; absence of candidates is not proof of absence.');
    result.status=done&&complete?'complete':'partial';
    await attachSemanticSourceReferences({ store, result, signal, began: deadline - limits.workMs, limits });
    let pendingContinuation = null;
    if(!done){if(!progressed)throw fail('ERR_SEMANTIC_OUTPUT_LIMIT','Selected operation evidence exceeds output allowance.');result.cursor=randomUUID();pendingContinuation={key,offset,seed,expires:Date.now()+ttlMs};result.frontier.push({reason:'response_budget',remainingCount:1});}
    if(Buffer.byteLength(JSON.stringify(result))>limits.bytes)throw fail('ERR_SEMANTIC_OUTPUT_LIMIT','Semantic response exceeds output budget.');
    assertSemanticFind('result',result);
    if(pendingContinuation){const now=Date.now();for(const [token,saved]of continuations)if(saved.expires<=now)continuations.delete(token);continuations.set(result.cursor,pendingContinuation);while(continuations.size>maxContinuations)continuations.delete(continuations.keys().next().value);}
    return result;
  };
  // A page owns a bounded set of verified readers; cursors retain only facts.
  // A fresh page/request must verify the current source content again.
  return async args => {
    const captured = { ...args, request: captureSemanticRequest(args.request, SEMANTIC_FIND_REQUEST_SCHEMA) };
    return typeof captured.store?.withReadScope === 'function'
      ? captured.store.withReadScope(() => find(captured)) : find(captured);
  };
};
