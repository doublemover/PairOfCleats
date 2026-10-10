import { planCompilerAdmission, assertCompilerAdmissionStart, makeCompilerAdmissionReceipt, normalizeCompilerAdmissionPolicy } from './compiler-admission.js';
import { loadCompilerAdmissionReceipts, persistCompilerAdmission, persistCompilerAdmissionDeferral } from './compiler-admission-evidence.js';
import { semanticHash } from './identity.js';
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
  const authorities = new Map(selected.map(item => [compilerInventoryHash(item.compilerInventory), item.compilerInventory]));
  if (authorities.size !== 1) throw new Error('Compiler batch requires one complete shared closure authority.');
  const inventory = [...authorities.values()][0], phases = selected.map(item => item.task.kind);
  const policies = selected.map(item => normalizeCompilerAdmissionPolicy(item.policy.execution.compilerAdmission));
  const admissionPolicy = Object.fromEntries(Object.keys(policies[0]).map(key => [key,
    key === 'measurementHeadroom' ? Math.max(...policies.map(policy => policy[key])) : Math.min(...policies.map(policy => policy[key]))]));
  const providerConfig = getToolingConfig(runtime.root)?.typescript || {};
  if (Number.isFinite(providerConfig.maxProgramFiles)) admissionPolicy.maxFiles = Math.min(admissionPolicy.maxFiles, Math.max(1, providerConfig.maxProgramFiles));
  const runtimeHash = semanticHash('semantic.compiler-admission-runtime.v1', { node: process.version, v8: process.versions.v8,
    platform: process.platform, arch: process.arch, execArgv: process.execArgv, compiler: inventory.compilerReceipt,
    analyses: [...new Set(selected.map(item => item.policy.identity.analysis))].sort() });
  const receipts = await loadCompilerAdmissionReceipts(runtime);
  const admissionOptions = { inventory, policy: admissionPolicy, schedulerStats: runtime.scheduler.stats(), schedulerConfig: runtime.schedulerConfig,
    runtimeHash, phases, explicit: Boolean(runtime.semanticEnrichmentDrain) || selected.some(item => item.policy.enrichment[item.phase] === 'eager'),
    inlineBudgetMs: Math.min(...selected.map(item => item.policy.planning.inlineBudgetMs)) };
  let decision = planCompilerAdmission(admissionOptions);
  for (const receipt of receipts.slice().reverse()) {
    const measured = planCompilerAdmission({ ...admissionOptions, receipt });
    if (measured.measurement.usable) { decision = measured; break; }
  }
  if (Number.isFinite(providerConfig.maxFileBytes) && inventory.closure.maxFileBytes > providerConfig.maxFileBytes) {
    decision = { ...decision, admitted: false, reason: 'compiler_closure_file_bytes_exceeded' };
  }
  if (!decision.admitted) {
    await persistCompilerAdmissionDeferral({ state, runtime, selected, decision, signal });
    return notRun(decision.reason);
  }
  const control = await openControl();
  if (!control.available) return notRun('sqlite_control_store_unavailable');
  const owner = 'compiler-batch:' + selected[0].task.taskId, leased = [], started = Date.now();
  const child = new AbortController(), abort = () => child.abort(signal?.reason);
  signal?.addEventListener('abort',abort,{once:true}); if (signal?.aborted) abort();
  const leaseMs = Math.max(60000,(maxMs || 0)+30000);
  let deadline = false, renewal = null, timer = null, completed = false, primaryFailure = null, deferredDecision = null;
  const previous = { sources:state.semanticAdmittedSources,phases:state.semanticPhaseAdmissions,
    authorities:state.semanticCompilerDependencyInventories,facts:new Map(state.semanticFactsByFile),contexts:state.semanticCompilerContexts,
    receipts:[...(state.semanticCompletedTasks || [])], admission:state.semanticCompilerAdmissionGrant };
  const check = () => {
    if (maxMs !== null && Date.now()-started >= maxMs) { deadline=true; child.abort(); }
    throwIfAborted(child.signal);
  };
  const renew = () => { for (const item of leased) control.renew({taskId:item.task.taskId,owner,leaseMs}); };
  try {
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
    const output=await runtime.scheduler.schedule('relations',{...decision.request,signal:child.signal},()=>{
      assertCompilerAdmissionStart(decision, runtime.scheduler.stats(), runtime.schedulerConfig);
      state.semanticCompilerAdmissionGrant = { authorityHash: compilerInventoryHash(inventory), decision };
      return fn({signal:child.signal});
    });
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
    await persistCompilerAdmission({ state, selected, decision, signal: child.signal, receipt: makeCompilerAdmissionReceipt({
      decision, runtimeHash, elapsedMs: Date.now()-started, peakRssBytes: process.resourceUsage().maxRSS * 1024, complete: true }) });
    completed=true;
    return {ran:true,output,receipts,elapsedMs:Date.now()-started};
  } catch(error) {
    primaryFailure = error;
    if (error.code === 'ERR_SEMANTIC_COMPILER_ADMISSION' && error.reason) {
      deferredDecision = { ...decision, admitted: false, reason: error.reason };
      return notRun(error.reason);
    }
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
    state.semanticAdmittedSources=previous.sources;state.semanticPhaseAdmissions=previous.phases;state.semanticCompilerDependencyInventories=previous.authorities;state.semanticCompilerAdmissionGrant=previous.admission;
    try {control.close();} catch(error) {cleanupFailure ||= error;}
    if (deferredDecision) await persistCompilerAdmissionDeferral({ state, runtime, selected, decision: deferredDecision, signal });
    if(!primaryFailure && cleanupFailure) throw cleanupFailure;
  }
};
