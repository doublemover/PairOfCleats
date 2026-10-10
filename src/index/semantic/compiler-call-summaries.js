import { canonicalSemanticJson } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';
const key = canonicalSemanticJson;
const channelKinds = new Set(['defines', 'reads', 'flowsTo', 'returns', 'captures']);
/** Iterative SCC decomposition; postorder processes callee components before callers. */
const components = (graph, signal) => {
  const seen=new Set(),order=[],reverse=new Map([...graph.keys()].map(id=>[id,new Set()]));
  for(const [from,targets] of graph)for(const to of targets)reverse.get(to)?.add(from);
  for(const start of graph.keys()){
    if(seen.has(start))continue;
    const stack=[{id:start,exit:false}];
    while(stack.length){throwIfAborted(signal);const item=stack.pop();if(item.exit){order.push(item.id);continue;}if(seen.has(item.id))continue;seen.add(item.id);stack.push({id:item.id,exit:true});for(const id of graph.get(item.id)||[])if(!seen.has(id))stack.push({id,exit:false});}
  }
  seen.clear();const result=[];
  for(const start of order.reverse()){
    if(seen.has(start))continue;const component=[],stack=[start];
    while(stack.length){throwIfAborted(signal);const id=stack.pop();if(seen.has(id))continue;seen.add(id);component.push(id);for(const parent of reverse.get(id)||[])if(!seen.has(parent))stack.push(parent);}
    result.push(component.sort());
  }
  return result.reverse();
};
/** Bounded monotone parameter-to-return may-depend summaries; effects remain separate. */
export const buildCallDependencySummaries = (documents, { maxIterations = 12, signal } = {}) => {
  const functions=new Map(),reverse=new Map(),calls=[],graph=new Map();
  let remainingWork=1000000,exhausted=false;
  const add=(from,to)=>{
    if(!from||!to)return false;const a=key(from),b=key(to);
    if(!reverse.has(b))reverse.set(b,new Set());const inputs=reverse.get(b),changed=!inputs.has(a);inputs.add(a);return changed;
  };
  for(const document of documents){
    for(const edge of document.flowEdges||[])if(channelKinds.has(edge.kind))add(edge.from,edge.to);
    const owners=document.summaries.filter(summary=>summary.declaration).sort((a,b)=>(a.span?.[0]||0)-(b.span?.[0]||0)||(b.span?.[1]||0)-(a.span?.[1]||0));
    for(const summary of owners){const id=key(summary.declaration);functions.set(id,{...summary,dependencies:new Set(),calls:[],maxRounds:document.policy?.enrichment.maxSccIterations??maxIterations,converged:false});graph.set(id,new Set());}
    // Source-ordered interval sweep assigns nested invocations without scanning all declarations.
    const scopeStack=[];let nextOwner=0;
    for(const call of [...document.calls].sort((a,b)=>(a.span?.[0]||0)-(b.span?.[0]||0))){
      const start=call.span?.[0],end=call.span?.[1];
      while(nextOwner<owners.length&&owners[nextOwner].span?.[0]<=start){const owner=owners[nextOwner++];while(scopeStack.length&&scopeStack.at(-1).span[1]<=owner.span[0])scopeStack.pop();scopeStack.push(owner);}
      while(scopeStack.length&&scopeStack.at(-1).span[1]<end)scopeStack.pop();
      const owner=scopeStack.at(-1),ownerId=owner?key(owner.declaration):null;
      const entry={...call,ownerId};calls.push(entry);if(ownerId)functions.get(ownerId).calls.push(entry);
    }
  }
  for(const call of calls)if(call.ownerId&&call.targets.length===1&&functions.has(key(call.targets[0])))graph.get(call.ownerId).add(key(call.targets[0]));
  const derive=summary=>{
    const ordinals=new Map();summary.parameters.forEach((ref,ordinal)=>{if(ref)ordinals.set(key(ref),ordinal);});
    const pending=summary.returns.map(key),seen=new Set();let changed=false;
    while(pending.length){
      throwIfAborted(signal);if(remainingWork--<=0){exhausted=true;break;}
      const current=pending.pop();if(seen.has(current))continue;seen.add(current);
      if(ordinals.has(current)&&!summary.dependencies.has(ordinals.get(current))){summary.dependencies.add(ordinals.get(current));changed=true;}
      for(const previous of reverse.get(current)||[])pending.push(previous);
    }
    return changed;
  };
  const instantiate=call=>{
    if(call.targets.length!==1||call.invocationKind==='construct'||call.hasSpread)return false;
    const target=functions.get(key(call.targets[0]));if(!target||target.async||target.generator)return false;
    let changed=false;for(const ordinal of target.dependencies)changed=add(call.arguments?.[ordinal],call.result)||changed;return changed;
  };
  let iterations=0,converged=true;
  for(const component of components(graph,signal)){
    let changed=true,round=0;const roundLimit=Math.min(maxIterations,...component.map(id=>functions.get(id).maxRounds));
    while(changed&&!exhausted&&round<roundLimit){
      changed=false;round++;iterations++;
      for(const id of component){const summary=functions.get(id);for(const call of summary.calls)changed=instantiate(call)||changed;changed=derive(summary)||changed;}
    }
    const complete=!changed&&!exhausted;converged=complete&&converged;
    for(const id of component)functions.get(id).converged=complete;
    if(exhausted)break;
  }
  return {functions,converged:converged&&!exhausted,iterations};
};
