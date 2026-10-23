import { performance } from 'node:perf_hooks';
import { canonicalSemanticJson, semanticHash } from './identity.js';
import { semanticTaskInputHash } from './frontier.js';
import { assertSemanticTask } from '../../contracts/validators/semantic-task.js';
import { assertSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';
import { readPersistedCompilerSummaryManifest } from './compiler-summary-admission.js';
import { reconcileCompilerSummaryDemandSeed } from './reconcile.js';
import { throwIfAborted } from '../../shared/abort.js';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const invalid = message => Object.assign(new TypeError(message), { code: 'ERR_SEMANTIC_SUMMARY_DEMAND' });
const LIMITS = Object.freeze({ maxWork: 4096, maxSummaries: 128, maxRetainedBytes: 1048576, maxIterations: 128, maxMs: 30000 });

const capture = (request, context, signal) => {
  const owned = JSON.parse(canonicalSemanticJson({ request, context }, { maxBytes: 1048576, check: () => throwIfAborted(signal) }));
  request = owned.request;
  canonicalSemanticJson(request, { maxBytes: 16384, check: () => throwIfAborted(signal) });
  if (!exact(request, ['schemaVersion', 'mode', 'generation', 'inventoryHash', 'seed', 'sourceUnitId', 'sourceHash',
    'policyHash', 'summaryIdentityHash', 'need', 'limits']) || request.schemaVersion !== 1 || request.mode !== 'plan'
    || !exact(request.seed, ['partitionId', 'localId']) || !/^(?:sy1|sa1):[a-f0-9]{64}$/u.test(request.seed.partitionId)
    || !Number.isSafeInteger(request.seed.localId) || request.seed.localId < 0
    || !/^su1:[a-f0-9]{64}$/u.test(request.sourceUnitId)
    || !['inventoryHash', 'sourceHash', 'policyHash', 'summaryIdentityHash'].every(key => hash(request[key]))
    || !exact(request.need, ['kind']) || request.need.kind !== 'return-value-inputs'
    || !exact(request.limits, Object.keys(LIMITS)) || Object.entries(LIMITS).some(([key, max]) =>
    !Number.isSafeInteger(request.limits[key]) || request.limits[key] < 0 || request.limits[key] > max)) {
    throw invalid('Invalid plan-only compiler summary demand.');
  }
  assertSemanticEnvelope('generation', request.generation);
  if (!exact(owned.context, ['descriptor', 'registeredInventory', 'expectedIdentity', 'tasks'])
    || !Array.isArray(owned.context.tasks) || owned.context.tasks.length > 128) throw invalid('Invalid summary-demand frontier context.');
  owned.context.tasks.forEach(assertSemanticTask);
  return owned;
};

/** Plan only: no Program, scheduler, control database, lease, enqueue or publisher
 * is accepted by this API. Existing task IDs remain proposals needing the normal
 * target/dependency/lease/publication checks after explicit future authorization.
 */
export const planCompilerSummaryDemand = async ({ store, request, context, signal = null }) => {
  const began = performance.now();
  throwIfAborted(signal);
  ({ request, context } = capture(request, context, signal));
  const limits = request.limits;
  const root = store?.storeId;
  const planId = 'sd1:' + semanticHash('semantic.summary-demand-plan.v1', { request,
    descriptor: context.descriptor, expectedIdentity: context.expectedIdentity, tasks: context.tasks });
  let work = 0, retainedBytes = 0;
  let responseBytes = Buffer.byteLength(canonicalSemanticJson({ generation: request.generation, seed: request.seed,
    need: request.need, limits })) + 8192;
  const frontier = [], planned = [], candidates = [], blockers = new Set();
  const finish = status => {
    const elapsedMs = Math.max(0, Math.floor(performance.now() - began));
    const result = { schemaVersion: 1, mode: 'plan', planId, status, generation: request.generation, inventoryHash: request.inventoryHash,
      seed: request.seed, need: request.need, executionAllowed: false, enqueueAllowed: false, requiresExplicitEnqueue: true,
      analysisExecuted: false, summaryReuseQualified: false, fallback: 'existing-whole-group-compiler-task',
      blockers: [...blockers].sort(), plannedSummaries: planned, candidateTasks: candidates, frontier,
      budgets: { limits, consumed: { work, retainedBytes, iterations: 0, elapsedMs },
        remaining: { work: Math.max(0, limits.maxWork - work), retainedBytes: Math.max(0, limits.maxRetainedBytes - retainedBytes),
          summaries: Math.max(0, limits.maxSummaries - planned.length), iterations: limits.maxIterations,
          ms: Math.max(0, limits.maxMs - elapsedMs) } } };
    const snapshot = JSON.parse(canonicalSemanticJson(result, { maxBytes: 65536 }));
    const pending = [snapshot];
    while (pending.length) { const value = pending.pop(); if (value && typeof value === 'object') { pending.push(...Object.values(value)); Object.freeze(value); } }
    return snapshot;
  };
  const stop = (reason, ref = request.seed) => {
    const value = { reason, ref }, bytes = Buffer.byteLength(canonicalSemanticJson(value));
    if (frontier.length < 128 && bytes <= 60000 - responseBytes) { frontier.push(value); responseBytes += bytes; }
    blockers.add(reason);
  };
  const step = (cost = 1) => {
    throwIfAborted(signal);
    if (performance.now() - began >= limits.maxMs) { stop('summary_demand_planning_deadline'); return false; }
    if (cost > limits.maxWork - work) { stop('summary_demand_work_budget'); return false; }
    work += cost; return true;
  };
  const retain = (value, output = true) => {
    const bytes = Buffer.byteLength(canonicalSemanticJson(value, { maxBytes: 1048576 }));
    if (bytes > limits.maxRetainedBytes - retainedBytes) { stop('summary_demand_retained_byte_budget'); return false; }
    if (output && bytes > 60000 - responseBytes) { stop('summary_demand_response_byte_budget'); return false; }
    if (output) responseBytes += bytes;
    retainedBytes += bytes; return true;
  };
  if (!limits.maxIterations) { stop('summary_demand_analysis_iteration_budget_zero'); return finish('partial'); }
  if (!limits.maxSummaries) { stop('summary_demand_summary_budget'); return finish('partial'); }
  if (!retain(request, false) || !step()) return finish('partial');
  const seed = await reconcileCompilerSummaryDemandSeed({ store, request, signal });
  if (!seed.compatible) { stop(seed.reason); return finish('unsupported'); }
  if (!step()) return finish('partial');
  if (!context.descriptor || !Number.isSafeInteger(context.descriptor.bytes)
    || context.descriptor.bytes > limits.maxRetainedBytes - retainedBytes) {
    stop('summary_demand_manifest_unavailable_or_retained_budget'); return finish('partial');
  }
  const { manifest, admission } = await readPersistedCompilerSummaryManifest({ root, descriptor: context.descriptor,
    registeredInventory: context.registeredInventory, expectedIdentity: context.expectedIdentity, signal });
  if (!step()) return finish('partial');
  if (!manifest || admission.status !== 'shadow-compatible') { stop(admission.reason); return finish('blocked'); }
  retainedBytes += context.descriptor.bytes;
  if (admission.identityHash !== request.summaryIdentityHash) { stop('summary_demand_dependency_identity_changed'); return finish('blocked'); }
  const sourcePolicy = manifest.identity.analysisPolicy?.sources?.find(row => row.source === request.sourceUnitId);
  if (!sourcePolicy || semanticHash('semantic.call-flow-policy.v1', sourcePolicy.enrichment) !== request.policyHash) {
    stop('summary_demand_policy_changed'); return finish('blocked');
  }
  admission.blockers.forEach(reason => blockers.add(reason));
  const summaries = new Map(manifest.summaries.map(summary => [summary.declaration, summary]));
  const pending = [canonicalSemanticJson(request.seed)], visited = new Set(), sourceUnits = new Set();
  while (pending.length) {
    if (!step()) return finish('partial');
    const id = pending.shift(); if (visited.has(id)) continue;
    if (planned.length === limits.maxSummaries) { stop('summary_demand_summary_budget', JSON.parse(id)); return finish('partial'); }
    visited.add(id);
    const summary = summaries.get(id);
    if (!summary) { stop('summary_demand_summary_missing', JSON.parse(id)); continue; }
    if (id === canonicalSemanticJson(request.seed)) {
      if (summary.localInputs.sourceUnitId !== request.sourceUnitId || summary.localInputs.sourceHash !== request.sourceHash) {
        stop('summary_demand_seed_manifest_source_changed'); return finish('blocked');
      }
    } else {
      if (!step(2)) return finish('partial');
      const callee = await reconcileCompilerSummaryDemandSeed({ store, request: { ...request, seed: JSON.parse(id),
        sourceUnitId: summary.localInputs.sourceUnitId, sourceHash: summary.localInputs.sourceHash }, signal });
      if (!step(0)) return finish('partial');
      if (!callee.compatible) { stop(callee.reason, JSON.parse(id)); continue; }
    }
    if (summary.payload.async || summary.payload.generator || summary.payload.widened) {
      stop('summary_demand_async_generator_or_widened_domain_unsupported', JSON.parse(id)); continue;
    }
    const source = summary.locator.sourceIdentity;
    if (source?.status !== 'qualified-for-comparison') { stop('summary_demand_source_locator_unqualified', JSON.parse(id)); continue; }
    const item = { declaration: JSON.parse(id), sourceUnitId: summary.localInputs.sourceUnitId,
      bodyHash: source.bodyHash, identityHash: summary.identityHash, payloadHash: summary.payloadHash,
      supportHash: summary.supportHash, complete: summary.payload.complete, converged: summary.payload.converged };
    if (!retain(item)) return finish('partial');
    planned.push(item); sourceUnits.add(item.sourceUnitId);
    if (!summary.payload.complete || !summary.payload.converged) blockers.add('summary_demand_callee_summary_incomplete');
    for (const callee of summary.callees) {
      if (!step()) return finish('partial');
      if (callee.status === 'missing') stop('summary_demand_unknown_callee', JSON.parse(callee.ref));
      else if (!visited.has(callee.ref)) pending.push(callee.ref);
    }
  }
  if (!planned.length) return finish('unsupported');
  for (const task of [...context.tasks].sort((a, b) => a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0)) {
    if (!step()) return finish('partial');
    if (task.kind !== 'crossFileFlow' || task.baseBuildId !== request.generation.baseBuildId
      || !task.coverageToProduce.includes('crossFileFlow') || ![...sourceUnits].every(source => task.sourceUnits.includes(source))) continue;
    const candidate = { taskId: task.taskId, policyHash: task.policyHash, inputHash: semanticTaskInputHash(task),
      targetSetHash: task.targetSetHash, targetsRef: task.targetsRef, scope: 'existing-whole-group',
      enqueueAllowed: false, reason: 'normal_target_dependency_lease_and_publication_admission_required' };
    if (!retain(candidate)) return finish('partial'); candidates.push(candidate);
  }
  blockers.add(candidates.length ? 'summary_demand_frontier_authority_requires_explicit_revalidation' : 'summary_demand_existing_frontier_task_unavailable');
  return finish('blocked');
};
