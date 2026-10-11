import { canonicalSemanticJson } from './identity.js';
import { collectCompilerCrossFileFlow } from './compiler-cross-file-flow.js';
import { throwIfAborted } from '../../shared/abort.js';
/** Validated provider call sites can contribute candidates to existing source summaries. */
export const joinProviderCallSummaries = async ({group,output,store,state,policy,signal}) => {
  const bySite=new Map(),known=new Set(group.flowDocuments.flatMap(doc=>doc.summaries.map(summary=>summary.declaration).filter(Boolean).map(canonicalSemanticJson)));
  let remaining=4096,truncated=false;
  outer:for(const partition of output.partitions)for await(const edge of store.iterateRows(partition.partitionId,'semantic_edges',{signal})) {
    throwIfAborted(signal);if(--remaining<0){truncated=true;break outer;}
    if(!edge.callSite||!['callTarget','constructTarget'].includes(edge.kind)||!known.has(canonicalSemanticJson(edge.to)))continue;
    const key=canonicalSemanticJson(edge.callSite);if(!bySite.has(key))bySite.set(key,[]);const refs=bySite.get(key);
    if(!refs.some(ref=>canonicalSemanticJson(ref)===canonicalSemanticJson(edge.to))) {if(refs.length<32)refs.push(edge.to);else truncated=true;}
  }
  let changed=false;
  const flowDocuments=group.flowDocuments.map(doc=>({...doc,calls:doc.calls.map(call=>{
    const refs=bySite.get(canonicalSemanticJson(call.occurrence));if(!refs?.length)return call;
    const targets=[...new Map([...call.targets,...refs].map(ref=>[canonicalSemanticJson(ref),ref])).values()];changed=true;
    return {...call,targets:targets.slice(0,32),incompleteTargets:true,reason:truncated||targets.length>32?'provider_call_join_budget':'provider_call_target_candidates'};
  })}));
  if(!changed)return [];
  return collectCompilerCrossFileFlow({group:{...group,flowDocuments,providerInputHashes:output.partitions.map(row=>row.canonicalHash).sort()},state,policy,signal});
};
