import { canonicalSemanticJson } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';
const key = canonicalSemanticJson;
const channelKinds = new Set(['defines', 'reads', 'flowsTo', 'returns', 'captures', 'packs', 'throws']);
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
/** Bounded monotone parameter-to-return may-depend summaries; field effects and exception inputs are caller-instantiated may channels. */
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
    for(const summary of owners){const id=key(summary.declaration);functions.set(id,{...summary,dependencies:new Set(),exceptionDependencies:new Set(),effectDependencies:new Map(),aliases:new Map((document.aliases||[]).map(value=>[key(value.ref),value])),fieldPathDepth:document.policy?.enrichment.fieldPathDepth??8,widened:false,calls:[],maxRounds:document.policy?.enrichment.maxSccIterations??maxIterations,converged:false});graph.set(id,new Set());}
    // Source-ordered interval sweep assigns nested invocations without scanning all declarations.
    const scopeStack=[],routes=new Map();let nextOwner=0;
    for(const route of document.callEffects||[]){const id=key(route.result);if(!routes.has(id))routes.set(id,{reads:[],exceptionTargets:[],exceptionEscapes:false});const entry=routes.get(id);entry.reads.push(...route.reads);entry.exceptionTargets.push(...route.exceptionTargets);entry.exceptionEscapes ||= route.exceptionEscapes;}
    for(const call of [...document.calls].sort((a,b)=>(a.span?.[0]||0)-(b.span?.[0]||0))){
      const start=call.span?.[0],end=call.span?.[1];
      while(nextOwner<owners.length&&owners[nextOwner].span?.[0]<=start){const owner=owners[nextOwner++];while(scopeStack.length&&scopeStack.at(-1).span[1]<=owner.span[0])scopeStack.pop();scopeStack.push(owner);}
      while(scopeStack.length&&scopeStack.at(-1).span[1]<end)scopeStack.pop();
      const owner=scopeStack.at(-1),ownerId=owner?key(owner.declaration):null;
      const effectRoutes=routes.get(key(call.result));
      const entry={...call,ownerId,effectRoutes};calls.push(entry);if(ownerId)functions.get(ownerId).calls.push(entry);
    }
  }
  for(const call of calls)if(call.ownerId&&call.targets.length===1&&functions.has(key(call.targets[0])))graph.get(call.ownerId).add(key(call.targets[0]));
  const inputs = (summary, refs) => {
    const ordinals=new Map();summary.parameters.forEach((ref,ordinal)=>{if(ref)ordinals.set(key(ref),ordinal);});
    for(const field of summary.parameterFields||[])ordinals.set(key(field.ref),field.parameter);
    const pending=refs.filter(Boolean).map(key),seen=new Set(),result=new Set();
    while(pending.length){
      throwIfAborted(signal);if(remainingWork--<=0){exhausted=true;break;}
      const current=pending.pop();if(seen.has(current))continue;seen.add(current);
      if(ordinals.has(current))result.add(ordinals.get(current));
      for(const previous of reverse.get(current)||[])pending.push(previous);
    }
    return result;
  };
  const union=(target,values)=>{let changed=false;for(const value of values)if(!target.has(value)){target.add(value);changed=true;}return changed;};
  const derive=summary=>{
    let changed=union(summary.dependencies,inputs(summary,summary.returns));
    changed=union(summary.exceptionDependencies,inputs(summary,summary.exceptions||[]))||changed;
    for(const effect of summary.effects||[]){
      const id=key({parameter:effect.parameter,path:effect.path});
      if(!summary.effectDependencies.has(id))summary.effectDependencies.set(id,{parameter:effect.parameter,path:effect.path,refs:[],dependencies:new Set()});
      const entry=summary.effectDependencies.get(id);if(!entry.refs.some(ref=>key(ref)===key(effect.ref)))entry.refs.push(effect.ref);
      changed=union(entry.dependencies,inputs(summary,[effect.ref]))||changed;
    }
    return changed;
  };
  const instantiate=call=>{
    if(remainingWork--<=0){exhausted=true;return false;}
    if(call.targets.length!==1||call.invocationKind==='construct'||call.hasSpread)return false;
    const target=functions.get(key(call.targets[0]));if(!target||target.async||target.generator)return false;
    let changed=false;for(const ordinal of target.dependencies)changed=add(call.arguments?.[ordinal],call.result)||changed;
    const owner=functions.get(call.ownerId);if(!owner)return changed;
    // Only call-owned summaries propagate exception inputs. No raw callee payload crosses calls.
    for(const ordinal of target.exceptionDependencies)for(const destination of call.effectRoutes?.exceptionTargets||[])changed=add(call.arguments?.[ordinal],destination)||changed;
    if(call.effectRoutes?.exceptionEscapes)changed=union(owner.exceptionDependencies,inputs(owner,[...target.exceptionDependencies].map(ordinal=>call.arguments?.[ordinal])))||changed;
    for(const effect of [...target.effectDependencies.values()]){
      if(remainingWork--<=0){exhausted=true;break;}
      const argument=call.arguments?.[effect.parameter];if(!argument)continue;
      const alias=owner.aliases.get(key(argument));
      if(alias)for(const read of call.effectRoutes?.reads||[]){
        if(remainingWork--<=0){exhausted=true;break;}
        if(key(read.root)===key(alias.root)&&key(read.path)===key([...alias.path,...effect.path]))
          for(const ordinal of effect.dependencies)changed=add(call.arguments?.[ordinal],read.ref)||changed;
      }
      const parameter=alias?owner.parameters.findIndex(ref=>ref&&key(ref)===key(alias.root)):-1;
      if(parameter<0)continue;
      const path=[...alias.path,...effect.path];if(path.length>owner.fieldPathDepth){owner.widened=true;continue;}const id=key({parameter,path});
      if(!owner.effectDependencies.has(id)){owner.effectDependencies.set(id,{parameter,path,refs:[],dependencies:new Set()});changed=true;}
      changed=union(owner.effectDependencies.get(id).dependencies,inputs(owner,[...effect.dependencies].map(ordinal=>call.arguments?.[ordinal])))||changed;
    }
    return changed;
  };
  for(const summary of functions.values())if(summary.maxRounds>0&&maxIterations>0)derive(summary);
  let iterations=0,converged=true;
  for(const component of components(graph,signal)){
    let changed=true,round=0;const roundLimit=component.reduce((limit,id)=>Math.min(limit,functions.get(id).maxRounds),maxIterations);
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
