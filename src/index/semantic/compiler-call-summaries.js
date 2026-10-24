import { propertyPathsOverlap } from './compiler-property-paths.js';
import { canonicalSemanticJson } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { createCompilerSummaryRecorder, joinMayDependencies } from './compiler-summary-manifest.js';
import { createSummaryComponentWorklist } from './compiler-summary-worklist.js';
import { indexSummaryInformationDependencies } from './compiler-summary-information-dependencies.js';
const key = canonicalSemanticJson;
export const callInput = (call, ordinal) => ordinal === -1 ? call.receiver : call.arguments?.[ordinal];
export const callUnknownInputs = call => [...new Map([call.receiver, ...(call.arguments || []), ...(call.unknownInputs || [])]
  .filter(Boolean).map(ref => [key(ref), ref])).values()];
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
export const buildCallDependencySummaries = (documents, { maxIterations = 12, signal,
  manifestIdentity = null, manifestLimits = null, referenceSchedule = false } = {}) => {
  throwIfAborted(signal);
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 0) throw new TypeError('Invalid call summary iteration allowance.');
  const canonicalKeys = new WeakMap();
  const key = value => {
    if (!value || typeof value !== 'object') return canonicalSemanticJson(value);
    if (!canonicalKeys.has(value)) canonicalKeys.set(value, canonicalSemanticJson(value));
    return canonicalKeys.get(value);
  };
  const functions=new Map(),reverse=new Map(),calls=[],graph=new Map(),ownershipReasons=new Set();
  const summaryIndexes = new WeakMap(), summaryIds = new WeakMap(), nodeDependents = new Map();
  const nodeCalls = new Map(), cacheWatchers = new Map(), dirty = new Set(), dirtyCalls = new Set(), callRevisions = new WeakMap(), revisions = new Map();
  const callers = new Map(); let cacheMemberships = 0, cacheEntries = 0, activeCall = null, activeTarget = null, activeWorklist = null;
  const processed = new Set(), informationInvalidations = new Set();
  const markDirty = id => { dirty.add(id); if (processed.has(id)) informationInvalidations.add(id); activeWorklist?.mark(id); };
  const stats = { derives: 0, reverseEdgeVisits: 0, aliasCandidates: 0, callInstantiations: 0,
    reachabilityCacheHits: 0, dirtyFunctionVisits: 0, cachedMemberships: 0, componentMembershipChecks: 0 };
  const recorder = manifestIdentity ? createCompilerSummaryRecorder({ identity: manifestIdentity, signal,
    ...(manifestLimits || {}) }) : null;

  let remainingWork=1000000,exhausted=false;
  const add=(from,to)=>{
    if(!from||!to)return false;const a=key(from),b=key(to);
    if (activeCall) recorder?.contribution(activeCall.ownerId, key(activeCall.occurrence), a, b, activeTarget);
    if(!reverse.has(b))reverse.set(b,new Set());const inputs=reverse.get(b),changed=!inputs.has(a);inputs.add(a);
    if (changed) {
      for (const id of nodeDependents.get(b) || []) markDirty(id);
      for (const call of nodeCalls.get(b) || []) dirtyCalls.add(call);
      for (const query of cacheWatchers.get(b) || []) { query.valid = false; for (const call of query.calls) dirtyCalls.add(call); }
    }
    return changed;
  };
  const documentKeys = new WeakMap();
  const documentKey = document => {
    if (!documentKeys.has(document)) documentKeys.set(document, document.item?.source?.sourceUnitId || document.partition?.partitionId
      || document.summaries.reduce((smallest, summary) => summary.declaration && (!smallest || key(summary.declaration) < smallest) ? key(summary.declaration) : smallest, ''));
    return documentKeys.get(document);
  };
  const orderedDocuments = [...documents].sort((a,b) => documentKey(a) < documentKey(b) ? -1 : documentKey(a) > documentKey(b) ? 1 : 0);
  for(const document of orderedDocuments){
    for(const edge of document.flowEdges||[])if(channelKinds.has(edge.kind))add(edge.from,edge.to);
    const owners=document.summaries.filter(summary=>summary.declaration).sort((a,b)=>(a.span?.[0]||0)-(b.span?.[0]||0)||(b.span?.[1]||0)-(a.span?.[1]||0));
    const executionOwners=new Map(document.summaries.filter(summary=>summary.ownerRef)
      .map(summary=>[key(summary.ownerRef),summary.declaration ? key(summary.declaration) : null]));
    const aliasesByRef = new Map();
    for (const alias of document.aliases || []) {
      const id = key(alias.ref); if (!aliasesByRef.has(id)) aliasesByRef.set(id, []); aliasesByRef.get(id).push(alias);
    }
    for(const summary of owners){
      const id=key(summary.declaration);
      if (functions.has(id)) throw Object.assign(new Error('Duplicate source-qualified compiler summary declaration.'), { code: 'ERR_COMPILER_SUMMARY_IDENTITY' });
      const current={...summary,dependencies:new Set(),exceptionDependencies:new Set(),effectDependencies:new Map(),aliases:document.aliases||[],fieldPathDepth:document.policy?.enrichment.fieldPathDepth??8,widened:false,calls:[],maxRounds:document.policy?.enrichment.maxSccIterations??maxIterations,converged:false};
      if (!Number.isSafeInteger(current.maxRounds) || current.maxRounds < 0) throw new TypeError('Invalid source summary iteration allowance.');
      functions.set(id,current); graph.set(id,new Set()); revisions.set(id,0); summaryIds.set(current,id);
      recorder?.register(id, current, document);
      const ordinals = new Map(); current.parameters.forEach((ref, ordinal) => { if (ref) ordinals.set(key(ref), ordinal); });
      for (const field of current.parameterFields || []) ordinals.set(key(field.ref), field.parameter);
      const rootOrdinals = new Map(); current.parameters.forEach((ref, ordinal) => { if (ref && !rootOrdinals.has(key(ref))) rootOrdinals.set(key(ref), ordinal); });
      summaryIndexes.set(current, { ordinals, rootOrdinals, aliasesByRef, queries: new Map() });
    }
    // CFG execution owns computed-name calls, which can lie inside a method's
    // source span while being evaluated by its enclosing function. The interval
    // sweep remains only for legacy supplied summaries without CFG ownership.
    const scopeStack=[],routes=new Map();let nextOwner=0,ownershipUncertain=false;
    for(const route of document.callEffects||[]){
      const id=key(route.result);
      if(!routes.has(id))routes.set(id,{reads:[],exceptionTargets:[],exceptionEscapes:false,owners:new Set()});
      const entry=routes.get(id);entry.reads.push(...route.reads);entry.exceptionTargets.push(...route.exceptionTargets);entry.exceptionEscapes ||= route.exceptionEscapes;
      if(Object.hasOwn(route,'ownerRef'))entry.owners.add(key(route.ownerRef));
    }
    for(const call of [...document.calls].sort((a,b)=>(a.span?.[0]||0)-(b.span?.[0]||0)
      || (a.span?.[1]||0)-(b.span?.[1]||0) || (key(a.occurrence) < key(b.occurrence) ? -1 : key(a.occurrence) > key(b.occurrence) ? 1 : 0)
      || ((a.invocationKind || '') < (b.invocationKind || '') ? -1 : (a.invocationKind || '') > (b.invocationKind || '') ? 1 : 0))){
      if(document.orderedOperations?.has(key(call.result || call.occurrence)))continue;
      const start=call.span?.[0],end=call.span?.[1];
      while(nextOwner<owners.length&&owners[nextOwner].span?.[0]<=start){const owner=owners[nextOwner++];while(scopeStack.length&&scopeStack.at(-1).span[1]<=owner.span[0])scopeStack.pop();scopeStack.push(owner);}
      while(scopeStack.length&&scopeStack.at(-1).span[1]<end)scopeStack.pop();
      const effectRoutes=routes.get(key(call.result));
      const owner=scopeStack.at(-1);
      let ownerId=owner?key(owner.declaration):null;
      if(document.callExecutionOwnership==='cfg' || effectRoutes?.owners.size) {
        const qualified=effectRoutes?.owners.size===1 && executionOwners.has([...effectRoutes.owners][0]);
        ownerId=qualified ? executionOwners.get([...effectRoutes.owners][0]) : null;
        if(!qualified) {ownershipUncertain=true;ownershipReasons.add('call_execution_owner_unavailable_or_ambiguous');}
      }
      const entry={...call,ownerId,effectRoutes};calls.push(entry);if(ownerId)functions.get(ownerId).calls.push(entry);
      if (ownerId) recorder?.call(ownerId, call.targets, key);
    }
    if(ownershipUncertain)for(const owner of owners)functions.get(key(owner.declaration)).complete=false;
  }
  for(const call of calls)if(call.ownerId)for(const target of call.targets.slice(0,32))if(functions.has(key(target))){
    const targetId = key(target); graph.get(call.ownerId).add(targetId);
    if (!callers.has(targetId)) callers.set(targetId, new Set()); callers.get(targetId).add(call.ownerId);
  }
  const inputs = (summary, refs) => {
    const indexes = summaryIndexes.get(summary), ownerId = summaryIds.get(summary);
    const roots = refs.filter(Boolean).map(key), queryKey = JSON.stringify(roots);
    let query = indexes.queries.get(queryKey);
    if (query?.valid) {
      if (remainingWork-- <= 0) { exhausted = true; return new Set(); }
      stats.reachabilityCacheHits++;
      if (activeCall) query.calls.add(activeCall);
      return query.result;
    }
    const pending = roots.slice(), seen = new Set(), result = new Set();
    while(pending.length){
      throwIfAborted(signal);if(remainingWork--<=0){exhausted=true;break;}
      const current=pending.pop();if(seen.has(current))continue;seen.add(current);
      if (!nodeDependents.has(current)) nodeDependents.set(current, new Set()); nodeDependents.get(current).add(ownerId);
      if (activeCall) { if (!nodeCalls.has(current)) nodeCalls.set(current, new Set()); nodeCalls.get(current).add(activeCall); }
      if(indexes.ordinals.has(current))result.add(indexes.ordinals.get(current));
      for(const previous of reverse.get(current)||[]){ stats.reverseEdgeVisits++; pending.push(previous); }
    }
    recorder?.read(ownerId, seen);
    if (!exhausted && (query || cacheEntries < 4096) && cacheMemberships + seen.size <= 65536) {
      if (!query) { query = { valid: true, result, calls: new Set(), watched: new Set() }; cacheEntries++; }
      query.valid = true; query.result = result;
      if (activeCall) query.calls.add(activeCall);
      for (const current of seen) if (!query.watched.has(current)) {
        query.watched.add(current); cacheMemberships++;
        if (!cacheWatchers.has(current)) cacheWatchers.set(current, new Set()); cacheWatchers.get(current).add(query);
      }
      indexes.queries.set(queryKey, query); stats.cachedMemberships = cacheMemberships;
    }
    return result;
  };
  const union=joinMayDependencies;
  const supportedUnion = (summary, channel, target, values) => {
    recorder?.support(summaryIds.get(summary), channel, values, activeCall ? key(activeCall.occurrence) : null, activeTarget);
    return union(target, values);
  };
  const derive=summary=>{
    stats.derives++;
    let changed=supportedUnion(summary,'return',summary.dependencies,inputs(summary,summary.returns));
    changed=supportedUnion(summary,'exception',summary.exceptionDependencies,inputs(summary,summary.exceptions||[]))||changed;
    for(const effect of summary.effects||[]){
      const id=key({parameter:effect.parameter,path:effect.path});
      if(!summary.effectDependencies.has(id))summary.effectDependencies.set(id,{parameter:effect.parameter,path:effect.path,refs:[],dependencies:new Set()});
      const entry=summary.effectDependencies.get(id);if(!entry.refs.some(ref=>key(ref)===key(effect.ref)))entry.refs.push(effect.ref);
      changed=supportedUnion(summary,'effect:'+id,entry.dependencies,inputs(summary,[effect.ref]))||changed;
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
    if(call.effectRoutes?.exceptionEscapes)changed=supportedUnion(owner,'exception',owner.exceptionDependencies,inputs(owner,dependencyInputs(call,target,target.exceptionDependencies)))||changed;
    for(const effect of [...target.effectDependencies.values()]){
      if(target.restIndex>=0 && effect.parameter===target.restIndex) {changed=owner.complete!==false||changed;owner.complete=false;continue;}
      if(remainingWork--<=0){exhausted=true;break;}
      const argument=callInput(call,effect.parameter);if(!argument)continue;
      const aliases=summaryIndexes.get(owner).aliasesByRef.get(key(argument)) || [];
      stats.aliasCandidates += aliases.length;
      for(const alias of aliases) {
        for(const read of call.effectRoutes?.reads||[]){
          if(remainingWork--<=0){exhausted=true;break;}
          if(key(read.root)===key(alias.root)&&propertyPathsOverlap(read.path,[...alias.path,...effect.path]))
            for(const input of dependencyInputs(call,target,effect.dependencies))changed=add(input,read.ref)||changed;
        }
        const receiver=!owner.lexicalReceiver && owner.ownerRef && key(owner.ownerRef)===key(alias.root);
        const parameter=receiver?-1:(summaryIndexes.get(owner).rootOrdinals.get(key(alias.root)) ?? -1);
        if(parameter<0&&!receiver)continue;
        const path=[...alias.path,...effect.path];if(path.length>owner.fieldPathDepth){owner.widened=true;continue;}const id=key({parameter,path});
        if(!owner.effectDependencies.has(id)){owner.effectDependencies.set(id,{parameter,path,refs:[],dependencies:new Set()});changed=true;}
        changed=supportedUnion(owner,'effect:'+id,owner.effectDependencies.get(id).dependencies,inputs(owner,dependencyInputs(call,target,effect.dependencies)))||changed;
      }
    }
    return changed;
  };
  const instantiate = call => {
    if (remainingWork-- <= 0) { exhausted = true; return false; }
    stats.callInstantiations++;
    let changed = false;
    for(const ref of call.targets.slice(0,32)) {
      activeTarget = key(ref);
      try { changed = instantiateTarget(call,functions.get(activeTarget)) || changed; }
      finally { activeTarget = null; }
    }
    if(call.incompleteTargets || call.targets.length > 32 || !call.targets.length || call.hasSpread || call.targets.some(ref=>{const target=functions.get(key(ref));return !target||target.async||target.generator||!target.complete||call.invocationKind==='construct'&&!target.constructible;})) {
      for(const argument of callUnknownInputs(call)) changed = add(argument,call.result) || changed;
      const owner = functions.get(call.ownerId); if(owner) {
        changed=owner.complete!==false||changed; owner.complete = false;
        const values=callUnknownInputs(call);
        for(const value of values) {
          for(const read of call.effectRoutes?.reads || []) changed=add(value,read.ref)||changed;
          for(const destination of call.effectRoutes?.exceptionTargets || []) changed=add(value,destination)||changed;
        }
        if(call.effectRoutes?.exceptionEscapes) changed=supportedUnion(owner,'exception',owner.exceptionDependencies,inputs(owner,values))||changed;
      }
    }
    return changed;
  };
  const orderedIds = [...functions.keys()].sort();
  const information = indexSummaryInformationDependencies({ functions, calls, reverse, graph, key,
    signal,
    spend: () => { if (remainingWork-- <= 0) { exhausted = true; return false; } return true; } });
  stats.informationDependencyVisits = information.visits;
  stats.informationDependencyEdges = information.edges;
  for (const id of orderedIds) recorder?.scheduling(id, graph.get(id));
  for(const id of orderedIds) {
    if (exhausted) break;
    const summary = functions.get(id);
    if (!(summary.maxRounds>0&&maxIterations>0)) continue;
    if (derive(summary)) revisions.set(summaryIds.get(summary), 1);
  }
  const targetRevision = call => call.targets.slice(0, 32).map(ref => [key(ref), revisions.get(key(ref)) ?? null]);
  const needsCall = call => dirtyCalls.has(call) || JSON.stringify(callRevisions.get(call)) !== JSON.stringify(targetRevision(call));
  let iterations=0,converged=true;
  for (const id of orderedIds) { const targets = graph.get(id); graph.delete(id); graph.set(id, new Set([...targets].sort())); }
  const schedulingComponents = components(graph,signal);
  for(const component of schedulingComponents){
    const members = new Set(component);
    for (const id of component) markDirty(id);
    const roundLimit=component.reduce((limit,id)=>Math.min(limit,functions.get(id).maxRounds),maxIterations);
    activeWorklist = createSummaryComponentWorklist({ component, dirty, roundLimit, reference: referenceSchedule });
    while(!exhausted){
      throwIfAborted(signal);
      const id = activeWorklist.next(); if (id === null) break;
      if (!dirty.delete(id)) continue;
      stats.dirtyFunctionVisits++;
      const summary=functions.get(id), beforeComplete=summary.complete, beforeWidened=summary.widened;
      let changed=false;
      for(const call of summary.calls) {
        if (!needsCall(call)) continue;
        dirtyCalls.delete(call); activeCall=call;
        try { changed=instantiate(call)||changed; }
        finally { activeCall=null; }
        callRevisions.set(call,targetRevision(call));
      }
      changed=derive(summary)||changed;
      changed=beforeComplete!==summary.complete||beforeWidened!==summary.widened||changed;
      if (changed) {
        revisions.set(id, (revisions.get(id) || 0) + 1);
        for (const caller of callers.get(id) || []) if (members.has(caller)) markDirty(caller);
      }
    }
    const worklist = activeWorklist.snapshot(); activeWorklist = null;
    iterations += worklist.rounds; stats.componentMembershipChecks += worklist.checks;
    const complete=!component.some(id => dirty.has(id))&&!exhausted;converged=complete&&converged;
    for(const id of component) { functions.get(id).converged=complete; processed.add(id); }
    if(exhausted)break;
  }
  const analysisReasons = [...dirty].some(id => informationInvalidations.has(id)) ? ['call_summary_information_dependency_unsettled'] : [];
  for (const id of dirty) if (functions.has(id)) functions.get(id).converged = false;
  const complete = converged && !exhausted && dirty.size === 0;
  return {functions,converged:complete,budgetIncomplete:!converged || exhausted,iterations,stats,schedulingComponents,
    informationSchedulingComplete:information.complete,ownershipReasons:[...ownershipReasons].sort(),
    analysisReasons,
    shadowManifest: recorder?.finish({ functions, reverse, converged: complete, ownershipReasons, analysisReasons }) || null};
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
