import { assertSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { createArtifactSemanticStore } from '../../semantic/artifact-store.js';
import { throwIfAborted } from '../../shared/abort.js';
import { getToolingConfig } from '../../shared/dict-utils.js';
import { compilerInventoryHash, verifyCompilerDependencyInventory } from './compiler-dependencies.js';
import { validateSemanticPartitions } from './reconcile.js';
import { semanticTaskInputHash } from './frontier.js';

/** All dependent phases hold durable leases before one shared Program is admitted. */
export const runSemanticTaskBatch = async ({ state, runtime, selected, signal, fn, openControl }) => {
  const notRun = reason => ({ ran:false,reason,receipts:[] });
  if (!selected.length) return notRun('manual_deferred_compiler_tasks');
  if (typeof runtime.scheduler?.schedule !== 'function') return notRun('existing_relations_scheduler_unavailable');
  const limits = selected.map(item => item.policy.executionMode === 'deferred' ? item.policy.execution.afterIndexMaxMs
    : item.policy.enrichment[item.phase] === 'auto' ? item.policy.planning.inlineBudgetMs : null).filter(value => value !== null);
  const maxMs = runtime.semanticEnrichmentDrain?.maxMs ?? (limits.length ? Math.min(...limits) : null);
  if (maxMs === 0) return notRun('analysis_budget_exhausted');
  const control = await openControl();
  if (!control.available) return notRun('sqlite_control_store_unavailable');
  const owner = 'compiler-batch:' + selected[0].task.taskId, leased = [], started = Date.now();
  const child = new AbortController(), abort = () => child.abort(signal?.reason);
  signal?.addEventListener('abort',abort,{once:true}); if (signal?.aborted) abort();
  const leaseMs = Math.max(60000,(maxMs || 0)+30000);
  let deadline = false, renewal = null, timer = null, completed = false, primaryFailure = null;
  const previous = { sources:state.semanticAdmittedSources,phases:state.semanticPhaseAdmissions,
    authorities:state.semanticCompilerDependencyInventories,facts:new Map(state.semanticFactsByFile),contexts:state.semanticCompilerContexts,
    receipts:[...(state.semanticCompletedTasks || [])] };
  const check = () => {
    if (maxMs !== null && Date.now()-started >= maxMs) { deadline=true; child.abort(); }
    throwIfAborted(child.signal);
  };
  const renew = () => { for (const item of leased) control.renew({taskId:item.task.taskId,owner,leaseMs}); };
  try {
    const authorities = new Map(selected.map(item => [compilerInventoryHash(item.compilerInventory),item.compilerInventory]));
    for (const inventory of authorities.values()) {
      check(); await verifyCompilerDependencyInventory({inventory,repoRoot:runtime.root,toolingConfig:getToolingConfig(runtime.root),signal:child.signal});
    }
    for (const item of selected) {
      check();
      const [lease] = control.leaseReady({baseBuildId:item.task.baseBuildId,taskId:item.task.taskId,owner,limit:1,leaseMs,
        dependencyHashes:new Map(item.task.dependencies.map(row => [row.dependencyKey,row.expectedHash]))});
      if (!lease) return notRun('compiler_task_not_ready');
      leased.push(item);
    }
    renewal=setInterval(()=>{try {renew();} catch(error){child.abort(error);}},Math.floor(leaseMs/3));renewal.unref?.();
    if(maxMs !== null) {timer=setTimeout(()=>{deadline=true;child.abort();},Math.max(1,maxMs-(Date.now()-started)));timer.unref?.();}
    state.semanticAdmittedSources = new Set(selected.flatMap(item=>item.task.sourceUnits));
    state.semanticPhaseAdmissions = new Map();
    for(const item of selected) for(const source of item.task.sourceUnits) {
      const phases=state.semanticPhaseAdmissions.get(source)||new Set(); phases.add('bindings'); phases.add(item.phase);
      if(item.phase === 'crossFileFlow') phases.add('localFlow'); state.semanticPhaseAdmissions.set(source,phases);
    }
    state.semanticCompilerDependencyInventories=[...authorities.values()];
    const output=await runtime.scheduler.schedule('relations',{cpu:1,io:1,mem:1,
      bytes:Math.max(...selected.map(item=>item.policy.storage.batchBytes)),signal:child.signal},()=>fn({signal:child.signal}));
    check(); assertSemanticEnvelope('provider',output);
    for(const inventory of authorities.values()) await verifyCompilerDependencyInventory({inventory,repoRoot:runtime.root,toolingConfig:getToolingConfig(runtime.root),signal:child.signal});
    const partitions=[...state.semanticFactsByFile.values()].flatMap(entry=>entry.partitions);
    const {root,generation}=selected[0];
    const store=createArtifactSemanticStore({root,repoRoot:runtime.root,artifactSurfaceVersion:ARTIFACT_SURFACE_VERSION,generation,partitions});
    await validateSemanticPartitions({store,partitions,signal:child.signal});
    const completedScopes=new Set();
    for(const partition of output.partitions) {
      if(!partitions.some(row=>row.partitionId===partition.partitionId&&row.canonicalHash===partition.canonicalHash)) throw new Error('Compiler phase output is not durable in this generation: ' + partition.partitionId + ' expected ' + partition.canonicalHash + ' found ' + partitions.find(row => row.partitionId === partition.partitionId)?.canonicalHash);
      for await(const coverage of store.iterateRows(partition.partitionId,'semantic_coverage',{signal:child.signal})) {
        if(['complete','partial'].includes(coverage.state)) completedScopes.add(partition.sourceUnitId+':'+coverage.phase);
      }
    }
    if(selected.some(item=>item.task.sourceUnits.some(source=>!completedScopes.has(source+':'+item.phase)))) return notRun('compiler_phase_source_inventory_incomplete');
    check(); renew();
    const receipts=selected.map(({task})=>({taskId:task.taskId,baseBuildId:task.baseBuildId,inputHash:semanticTaskInputHash(task),policyHash:task.policyHash}));
    state.semanticCompletedTasks ||= [];
    for(const receipt of receipts) if(!state.semanticCompletedTasks.some(row=>row.taskId===receipt.taskId)) state.semanticCompletedTasks.push(receipt);
    completed=true;
    return {ran:true,output,receipts,elapsedMs:Date.now()-started};
  } catch(error) {
    primaryFailure = error;
    if(deadline&&!signal?.aborted) return notRun('analysis_budget_exhausted');
    throw error;
  } finally {
    if(timer)clearTimeout(timer);if(renewal)clearInterval(renewal);signal?.removeEventListener('abort',abort);
    let cleanupFailure = null;
    if(!completed) {
      state.semanticFactsByFile=previous.facts;state.semanticCompilerContexts=previous.contexts;state.semanticCompletedTasks=previous.receipts;
      for(const item of leased) {
        try {control.release({taskId:item.task.taskId,owner,reason:deadline?'analysis_budget_exhausted':'compiler_batch_not_completed',transient:true,cancelled:signal?.aborted===true});}
        catch(error){if(error.code!=='ERR_SEMANTIC_LEASE_LOST')cleanupFailure ||= error;}
      }
    }
    state.semanticAdmittedSources=previous.sources;state.semanticPhaseAdmissions=previous.phases;state.semanticCompilerDependencyInventories=previous.authorities;
    try {control.close();} catch(error) {cleanupFailure ||= error;}
    if(!primaryFailure && cleanupFailure) throw cleanupFailure;
  }
};
