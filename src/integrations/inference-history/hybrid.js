import { historyError } from './common.js';
import { runHistoryCallback } from './bounded-callback.js';
import { READ_GUARDS, searchHistory, readHistoryCandidates } from './reader.js';
import { historyIndexState } from './generation.js';
import { fuseHistoryRanks, applyHistoryRerank } from './ranking.js';
const key=row=>JSON.stringify([row.sourceRef,row.snapshotRef]);
export async function searchHybridHistory(db,request,semantic,reauthorize) {
  const mode=request.mode ?? 'auto';
  if (!['auto','lexical','hybrid','semantic'].includes(mode)) throw historyError('ERR_INFERENCE_HISTORY_INPUT','Invalid retrieval mode.');
  const bodySurface=(request.searchField??'text')==='text'&&(request.groupBy??'evidence')==='evidence';
  const effectiveMode=mode==='auto'?(semantic&&bodySurface?'hybrid':'lexical'):mode;
  if(effectiveMode!=='lexical'&&!bodySurface)throw historyError('ERR_INFERENCE_HISTORY_INPUT','Semantic retrieval requires text evidence; select lexical mode for metadata/original grouping.');
  if (effectiveMode==='lexical') {
    const result=searchHistory(db,request);
    result.query.retrievalMode='lexical';result.query.requestedMode=mode;return result;
  }
  if (!semantic || semantic.kind!=='local') throw historyError('ERR_INFERENCE_HISTORY_UNAVAILABLE','Local semantic index not configured.');
  const state=historyIndexState(db);
  if (semantic.indexGenerationRef!==state.generationRef) throw historyError('ERR_INFERENCE_HISTORY_STALE','Semantic index requires refresh.');
  const candidateLimit=request.candidateLimit ?? 50,top=request.top ?? 10,offset=request.offset ?? 0;
  if (!Number.isSafeInteger(candidateLimit) || candidateLimit<1 || candidateLimit>100
    || !Number.isSafeInteger(top) || top<1 || top>100
    || !Number.isSafeInteger(offset) || offset<0 || offset>100000
    || (request.rerank!==undefined && typeof request.rerank!=='boolean'))
    throw historyError('ERR_INFERENCE_HISTORY_INPUT','Invalid retrieval page or controls.');
  // This first pass validates all filters and query syntax even in semantic-only mode.
  const lexical=searchHistory(db,{...request,top:candidateLimit,offset:0});
  const signal=AbortSignal.any([AbortSignal.timeout(10000),...(request.signal ? [request.signal]:[])]);
  const supplied=await runHistoryCallback(() => semantic.search({query:request.query,top:candidateLimit,generationRef:state.generationRef,request},{signal,reauthorize}), signal);
  await reauthorize();signal.throwIfAborted();
  if (historyIndexState(db).generationRef!==state.generationRef) throw historyError('ERR_INFERENCE_HISTORY_STALE','Index changed during semantic retrieval.');
  const semanticRows=readHistoryCandidates(db,request,supplied.candidates);
  const rankRows=rows=>rows.map(row=>({sourceRef:row.sourceRef,snapshotRef:row.snapshotRef,groupRef:row.recordRef}));
  const fused=fuseHistoryRanks({lexical:effectiveMode==='semantic'?[]:rankRows(lexical.hits),
    semantic:rankRows(semanticRows.hits),top:100,lexicalWeight:request.lexicalWeight ?? 1,
    semanticWeight:request.semanticWeight ?? 1,rankConstant:request.rankConstant ?? 60,
    maxPerGroup:request.maxPerConversation ?? null});
  const lookup=new Map([...semanticRows.hits,...lexical.hits].map(row=>[key(row),row]));
  let all=fused.results.map(row=>({...lookup.get(key(row)),score:row.score,scoreKind:'reciprocal_rank_fusion',retrievalRanks:row.ranks}));
  if (request.rerank===true) {
    if (typeof semantic.rerank!=='function') throw historyError('ERR_INFERENCE_HISTORY_UNAVAILABLE','Local reranker not configured.');
    const order=await runHistoryCallback(() => semantic.rerank(request.query,structuredClone(all),{signal}), signal);
    await reauthorize();signal.throwIfAborted();
    all=applyHistoryRerank(all,order);
  }
  const complete=(effectiveMode==='semantic'||(lexical.complete && lexical.nextOffset===null)) && supplied.complete && fused.candidateCount<=100;
  const result={...lexical,hits:all.slice(offset,offset+top),
    query:{...lexical.query,retrievalMode:effectiveMode,requestedMode:mode,semanticMatching:true},
    semantic:{modelId:semantic.modelId,modelVersion:semantic.modelVersion,dimensions:semantic.dimensions,
      coverage:semantic.coverage??null,indexGenerationRef:semantic.indexGenerationRef,contentManifestHash:semantic.contentManifestHash??null,candidateLimit,reranked:request.rerank===true,fusion:fused.method},
    limits:{...lexical.limits,top,offset,candidateLimit},complete,totalMatches:complete?all.length:null,
    observedGroups:all.length,totalMatchedUnits:null,candidateMatches:null,
    channels:{lexical:{candidateMatches:lexical.candidateMatches,totalMatchedUnits:lexical.totalMatchedUnits,complete:lexical.complete},
      semantic:{suppliedCandidates:supplied.candidates.length,authorizedGroups:semanticRows.hits.length,complete:supplied.complete}},
    nextOffset:offset+top<all.length?offset+top:null};
  Object.defineProperty(result,READ_GUARDS,{value:[...(lexical[READ_GUARDS]??[]),...(semanticRows[READ_GUARDS]??[])]});
  return result;
}
