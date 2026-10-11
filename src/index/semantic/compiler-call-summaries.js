import { propertyPathsOverlap } from './compiler-property-paths.js';
import { canonicalSemanticJson } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';
const key = canonicalSemanticJson;
export const callInput = (call, ordinal) => ordinal === -1 ? call.receiver : call.arguments?.[ordinal];
const argumentOrdinals = (call, summary, ordinal) => summary.restIndex >= 0 && ordinal === summary.restIndex
  ? (call.arguments || []).slice(ordinal).map((_,index)=>ordinal+index) : [ordinal];
const dependencyInputs = (call, summary, dependencies) => [...dependencies].flatMap(ordinal=>argumentOrdinals(call,summary,ordinal).map(index=>callInput(call,index)));
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
    for(const summary of owners){const id=key(summary.declaration);functions.set(id,{...summary,dependencies:new Set(),exceptionDependencies:new Set(),effectDependencies:new Map(),aliases:document.aliases||[],fieldPathDepth:document.policy?.enrichment.fieldPathDepth??8,widened:false,calls:[],maxRounds:document.policy?.enrichment.maxSccIterations??maxIterations,converged:false});graph.set(id,new Set());}
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
  for(const call of calls)if(call.ownerId)for(const target of call.targets.slice(0,32))if(functions.has(key(target)))graph.get(call.ownerId).add(key(target));
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
  const instantiateTarget=(call,target)=>{
    if(remainingWork--<=0){exhausted=true;return false;}
    if(!target||target.async||target.generator||call.invocationKind==='construct'&&!target.constructible||call.hasSpread)return false;
    let changed=false;if(!call.suppressResult)for(const input of dependencyInputs(call,target,target.dependencies))changed=add(input,call.result)||changed;
    const owner=functions.get(call.ownerId);if(!owner)return changed;
    // Only call-owned summaries propagate exception inputs. No raw callee payload crosses calls.
    for(const input of dependencyInputs(call,target,target.exceptionDependencies))for(const destination of call.effectRoutes?.exceptionTargets||[])changed=add(input,destination)||changed;
    if(call.effectRoutes?.exceptionEscapes)changed=union(owner.exceptionDependencies,inputs(owner,dependencyInputs(call,target,target.exceptionDependencies)))||changed;
    for(const effect of [...target.effectDependencies.values()]){
      if(target.restIndex>=0 && effect.parameter===target.restIndex) {changed=owner.complete!==false||changed;owner.complete=false;continue;}
      if(remainingWork--<=0){exhausted=true;break;}
      const argument=callInput(call,effect.parameter);if(!argument)continue;
      const aliases=owner.aliases.filter(value=>key(value.ref)===key(argument));
      for(const alias of aliases) {
        for(const read of call.effectRoutes?.reads||[]){
          if(remainingWork--<=0){exhausted=true;break;}
          if(key(read.root)===key(alias.root)&&propertyPathsOverlap(read.path,[...alias.path,...effect.path]))
            for(const input of dependencyInputs(call,target,effect.dependencies))changed=add(input,read.ref)||changed;
        }
        const receiver=!owner.lexicalReceiver && owner.ownerRef && key(owner.ownerRef)===key(alias.root);
        const parameter=receiver?-1:owner.parameters.findIndex(ref=>ref&&key(ref)===key(alias.root));
        if(parameter<0&&!receiver)continue;
        const path=[...alias.path,...effect.path];if(path.length>owner.fieldPathDepth){owner.widened=true;continue;}const id=key({parameter,path});
        if(!owner.effectDependencies.has(id)){owner.effectDependencies.set(id,{parameter,path,refs:[],dependencies:new Set()});changed=true;}
        changed=union(owner.effectDependencies.get(id).dependencies,inputs(owner,dependencyInputs(call,target,effect.dependencies)))||changed;
      }
    }
    return changed;
  };
  const instantiate = call => {
    let changed = false;
    for(const ref of call.targets.slice(0,32)) changed = instantiateTarget(call,functions.get(key(ref))) || changed;
    if(call.incompleteTargets || call.targets.length > 32 || !call.targets.length || call.hasSpread || call.targets.some(ref=>{const target=functions.get(key(ref));return !target||target.async||target.generator||!target.complete||call.invocationKind==='construct'&&!target.constructible;})) {
      for(const argument of [call.receiver,...(call.arguments || [])]) changed = add(argument,call.result) || changed;
      const owner = functions.get(call.ownerId); if(owner) {
        changed=owner.complete!==false||changed; owner.complete = false;
        const values=[call.receiver,...(call.arguments || [])].filter(Boolean);
        for(const value of values) {
          for(const read of call.effectRoutes?.reads || []) changed=add(value,read.ref)||changed;
          for(const destination of call.effectRoutes?.exceptionTargets || []) changed=add(value,destination)||changed;
        }
        if(call.effectRoutes?.exceptionEscapes) changed=union(owner.exceptionDependencies,inputs(owner,values))||changed;
      }
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

/** Join known alternatives at the call site without promoting the remainder to exactness. */
export const joinCallDependencySummaries = (call, functions) => {
  const targets = call.targets.slice(0,32).map(ref=>functions.get(key(ref)));
  const usable = targets.filter(summary=>summary && !summary.async && !summary.generator && (call.invocationKind !== 'construct'||summary.constructible));
  if(!usable.length) return null;
  const effects = new Map(), refs = values => [...new Map(values.map(ref=>[key(ref),ref])).values()];
  for(const summary of usable) for(const effect of summary.effectDependencies.values()) {
    if(summary.restIndex>=0 && effect.parameter===summary.restIndex)continue;
    const id=key({parameter:effect.parameter,path:effect.path});
    if(!effects.has(id)) effects.set(id,{...effect,refs:[],dependencies:new Set()});
    const result=effects.get(id); result.refs=refs([...result.refs,...effect.refs]);
    for(const dependency of effect.dependencies)for(const ordinal of argumentOrdinals(call,summary,dependency))result.dependencies.add(ordinal);
  }
  return {restEffectsUnsupported:usable.some(summary=>summary.restIndex>=0 && [...summary.effectDependencies.values()].some(effect=>effect.parameter===summary.restIndex)),parameterMappings:usable.map(summary=>({parameters:summary.parameters,restIndex:summary.restIndex??-1})),returns:refs(usable.flatMap(summary=>summary.returns)),exceptions:refs(usable.flatMap(summary=>summary.exceptions||[])),
    dependencies:new Set(usable.flatMap(summary=>[...summary.dependencies].flatMap(ordinal=>argumentOrdinals(call,summary,ordinal)))),exceptionDependencies:new Set(usable.flatMap(summary=>[...summary.exceptionDependencies].flatMap(ordinal=>argumentOrdinals(call,summary,ordinal)))),
    effectDependencies:effects, complete:!call.incompleteTargets && call.targets.length===usable.length && usable.every(summary=>summary.complete),
    converged:usable.every(summary=>summary.converged),widened:usable.some(summary=>summary.widened),alternatives:usable.length,
    remainder:call.incompleteTargets || call.targets.length!==usable.length};
};
