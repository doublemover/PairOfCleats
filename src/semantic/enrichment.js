import { verifyCompilerDependencyInventory, COMPILER_DEPENDENCY_KEY } from '../index/semantic/compiler-dependencies.js';
import { resolveSemanticPartPath } from './artifact-store.js';
import { getToolingConfig } from '../shared/dict-utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertSemanticEnrichment } from '../contracts/validators/semantic-enrichment.js';
import { getRepoCacheRoot, loadUserConfig } from '../shared/dict-utils.js';
import { atomicWriteJson } from '../shared/io/atomic-write.js';
import { semanticHash } from '../index/semantic/identity.js';
import { semanticTaskInputHash, openSemanticFrontier } from '../index/semantic/frontier.js';
import { reconcilePublishedSemanticBindingWork } from '../index/semantic/build-frontier.js';
import { createSemanticEnrichmentGrant } from '../index/semantic/enrichment-context.js';
import { isWithinRoot, toRealPathSync } from '../workspace/identity.js';
import { createEnrichmentBudget, enrichmentError, enrichmentSame, openEnrichmentInventory,
  readEnrichmentCurrent, verifyEnrichmentTask, verifyEnrichmentLiveSources } from './enrichment-inventory.js';

export const DEFAULT_ENRICHMENT_LIMITS = Object.freeze({ maxTasks: 32, maxBytes: 65536, maxMs: 2000, drainMaxMs: 60000 });
const sorted = values => [...values].sort();
const sameTaskInputs = (old, next) => old.kind === next.kind && old.policyHash === next.policyHash
  && semanticTaskInputHash(old) === semanticTaskInputHash(next)
  && enrichmentSame(sorted(old.sourceUnits), sorted(next.sourceUnits))
  && enrichmentSame(sorted(old.inputHashes), sorted(next.inputHashes));
const syntaxInventory = inventory => inventory.syntax.map(row => ({ sourceUnitId: row.sourceUnitId,
  partitionId: row.partitionId, canonicalHash: row.canonicalHash })).sort((a, b) => a.sourceUnitId.localeCompare(b.sourceUnitId));
const boundedResult = (result, limits) => {
  if (Buffer.byteLength(JSON.stringify(result)) > limits.maxBytes) throw enrichmentError('Enrichment response exceeds its byte allowance.', 'ERR_SEMANTIC_ENRICHMENT_BUDGET');
  return assertSemanticEnrichment('result', result);
};
const openControl = async ({ repoRoot, userConfig, Database, maxAttempts = 3 }) => {
  if (Database === undefined) {
    try { Database = (await import('better-sqlite3')).default; }
    catch (error) { if (['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) return { available: false }; throw error; }
  }
  if (typeof Database !== 'function') return { available: false };
  const cacheRoot = getRepoCacheRoot(repoRoot, userConfig), directory = path.join(cacheRoot, 'semantic-frontier');
  await fs.mkdir(directory, { recursive: true });
  if (!isWithinRoot(toRealPathSync(directory), toRealPathSync(cacheRoot))) throw enrichmentError('Frontier control directory escapes repository cache.');
  return openSemanticFrontier({ Database, filename: path.join(directory, 'control.sqlite'), maxAttempts });
};
const readJournal = async filename => {
  try {
    if ((await fs.stat(filename)).size > 1024 * 1024) throw enrichmentError('Enrichment recovery journal exceeds its allowance.');
    return assertSemanticEnrichment('journal', JSON.parse(await fs.readFile(filename, 'utf8')));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};

/** Shared plan-only default; enqueue mutates only the dedicated control store; drain uses normal whole-generation publication. */
export const runSemanticEnrichmentService = async ({ request, userConfig, signal = null, Database,
  build = null, dependencyAuthority = null }) => {
  assertSemanticEnrichment('request', request);
  userConfig ||= loadUserConfig(request.repoRoot);
  request = structuredClone({ ...request, action: request.action || 'plan', taskIds: request.taskIds || [],
    limits: request.limits || DEFAULT_ENRICHMENT_LIMITS });
  const { repoRoot, generation, limits, action } = request;
  const budget = createEnrichmentBudget(limits.maxMs, signal);
  const inventory = await budget.run(() => openEnrichmentInventory({ repoRoot, userConfig, generation, budget }));
  const ids = request.taskIds.length ? sorted(request.taskIds) : sorted(inventory.tasks.keys()).slice(0, limits.maxTasks);
  if (ids.length > limits.maxTasks) throw enrichmentError('Task selection exceeds its window allowance.', 'ERR_SEMANTIC_ENRICHMENT_BUDGET');
  const tasks = ids.map(id => {
    const task = inventory.tasks.get(id);
    if (!task) throw enrichmentError('Requested task is unavailable in the pinned generation.', 'ERR_SEMANTIC_UNAVAILABLE');
    return task;
  });
  for (const task of tasks) await budget.run(() => verifyEnrichmentTask({ inventory, task, budget }));
  const requestId = semanticHash('pairofcleats.semantic.enrichment-request.v1', { repoRoot: toRealPathSync(repoRoot),
    generation, taskIds: ids, sourceManifestHash: inventory.manifestHash });
  const result = { schemaVersion: 1, requestId, action, generation, executionAuthorized: action === 'drain', status: 'planned',
    tasks: tasks.map(task => ({ taskId: task.taskId, kind: task.kind, baseBuildId: task.baseBuildId,
      inputHash: semanticTaskInputHash(task), policyHash: task.policyHash, targetSetHash: task.targetSetHash,
      executable: false,
      reason: task.kind !== 'bind' ? 'executor_not_available' : 'dependency_authority_unavailable',
      state: inventory.manifest.completedTasks?.some(row => row.taskId === task.taskId) ? 'completed' : 'not-inspected' })),
    publishedGeneration: null, lineage: [], supportedExecutors: ['bind'], diagnostics: ['whole_generation_publication_only',
      'full_source_rebuild_no_targeted_parse_reuse'], validation: 'implementation-unverified' };
  if (!request.taskIds.length && inventory.tasks.size > limits.maxTasks) result.diagnostics.push('plan_window_truncated_select_exact_task_ids');
  dependencyAuthority ||= { async verify({ repoRoot, inventory, task, signal }) {
    const filename = await resolveSemanticPartPath(path.join(inventory.indexDir, 'semantic'), task.targetsRef);
    if ((await fs.stat(filename)).size > 32 * 1024 * 1024) throw enrichmentError('Compiler target inventory exceeds its allowance.');
    const target = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (semanticHash('pairofcleats.semantic.binding-targets.v1', target) !== task.targetSetHash || !target.compilerInventory) return null;
    const authority = await verifyCompilerDependencyInventory({ inventory: target.compilerInventory, repoRoot,
      toolingConfig: getToolingConfig(repoRoot), signal });
    return { verified: true, complete: true, authorityHash: authority.authorityHash,
      dependencyHashes: new Map([[COMPILER_DEPENDENCY_KEY, authority.authorityHash]]) };
  } };
  const authorities = new Map();
  const verifyAuthority = async (task, phase, signal) => {
    // A producer must freeze the complete compiler/config/module-resolution inventory.
    // Generic dependency entries, an empty list, or caller-supplied expected hashes are not proof.
    const dependency = task.dependencies.find(row => row.dependencyKey === 'semantic.compiler.dependency-inventory.v1');
    if (!dependency || typeof dependencyAuthority?.verify !== 'function') return null;
    const authority = await dependencyAuthority.verify({ repoRoot, inventory, task, phase, signal });
    if (authority?.verified !== true || authority.complete !== true || authority.authorityHash !== dependency.expectedHash
      || !(authority.dependencyHashes instanceof Map)
      || task.dependencies.some(row => authority.dependencyHashes.get(row.dependencyKey) !== row.expectedHash)) return null;
    return authority;
  };
  for (const task of tasks) {
    const authority = await budget.run(() => verifyAuthority(task, 'before-work', budget.signal));
    if (authority && task.kind === 'bind') {
      authorities.set(task.taskId, authority);
      Object.assign(result.tasks.find(row => row.taskId === task.taskId), { executable: true, reason: null });
    }
  }
  if (action === 'plan') return boundedResult(result, limits);
  if (action === 'drain' && (!tasks.length || result.tasks.some(row => !row.executable || row.state === 'completed'))) {
    result.status = 'blocked'; result.diagnostics.push('dependency_authority_unavailable_or_executor_not_available');
    return boundedResult(result, limits);
  }
  if (action === 'enqueue' && result.tasks.some(row => !row.executable)) result.diagnostics.push('dependency_authority_unavailable_pending_descriptor_only');
  const directory = path.join(getRepoCacheRoot(repoRoot, userConfig), 'semantic-frontier', 'drains');
  await fs.mkdir(directory, { recursive: true });
  const cacheRoot = toRealPathSync(getRepoCacheRoot(repoRoot, userConfig));
  if (!isWithinRoot(toRealPathSync(directory), cacheRoot)) throw enrichmentError('Drain journal escapes its repository cache.');
  const journalPath = path.join(directory, requestId + '.json'), previous = await readJournal(journalPath);
  const control = await openControl({ repoRoot, userConfig, Database });
  if (!control.available) { result.status = 'unavailable'; result.diagnostics.push('sqlite_control_store_unavailable'); return boundedResult(result, limits); }
  let current = null, journal = null, renewal = null, primaryFailure = null;
  const owner = 'manual-drain:' + randomUUID(), leases = new Map();
  const child = new AbortController(), abort = () => child.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let deadline = null;
  const writeJournal = async () => { assertSemanticEnrichment('journal', journal); await atomicWriteJson(journalPath, journal, { spaces: 0 }); };
  const recover = async candidate => {
    if (!candidate?.newBuildRoot || !candidate.lineage.length) return false;
    if (!candidate.publishedGeneration) throw enrichmentError('Recovery journal does not pin a published generation.');
    if (candidate.requestId !== requestId || candidate.sourceManifestHash !== inventory.manifestHash
      || !enrichmentSame(candidate.sourceGeneration, generation) || !enrichmentSame(candidate.taskIds, ids)) throw enrichmentError('Drain recovery journal identity mismatch.');
    if (!enrichmentSame(sorted(candidate.lineage.map(row => row.sourceTaskId)), ids)
      || new Set(candidate.lineage.map(row => row.replannedTaskId)).size !== candidate.lineage.length) throw enrichmentError('Recovery lineage does not identify each selected task exactly once.');
    const now = await readEnrichmentCurrent({ repoRoot, userConfig });
    if (toRealPathSync(candidate.newBuildRoot) !== now.buildRoot || !isWithinRoot(now.buildRoot, cacheRoot)) return false;
    const indexDir = path.join(now.buildRoot, 'index-code');
    const freshBudget = createEnrichmentBudget(limits.maxMs, signal);
    const fresh = await freshBudget.run(() => openEnrichmentInventory({ repoRoot, userConfig,
      generation: candidate.publishedGeneration, indexDir, budget: freshBudget }));
    if (fresh.manifest.generation.baseBuildId === generation.baseBuildId
      || !enrichmentSame(syntaxInventory(fresh), syntaxInventory(inventory))) throw enrichmentError('Recovery generation has changed source inputs.');
    if (candidate.publishedManifestHash && candidate.publishedManifestHash !== fresh.manifestHash) throw enrichmentError('Recovery manifest checksum changed.');
    for (const line of candidate.lineage) {
      const old = inventory.tasks.get(line.sourceTaskId), next = fresh.tasks.get(line.replannedTaskId);
      if (!old || !next) throw enrichmentError('Recovery lineage points to an unavailable task.');
      if (!await verifyAuthority(old, 'recovery', freshBudget.signal)) throw enrichmentError('Published output has no complete original dependency authority.');
      if (!old || !next || !sameTaskInputs(old, next) || line.inputHash !== semanticTaskInputHash(old) || line.policyHash !== old.policyHash
        || !fresh.manifest.completedTasks?.some(receipt => receipt.taskId === next.taskId && receipt.inputHash === line.inputHash
          && receipt.policyHash === line.policyHash && receipt.baseBuildId === fresh.manifest.generation.baseBuildId)) throw enrichmentError('Recovery lineage lacks exact completed published task output.');
      await freshBudget.run(() => verifyEnrichmentTask({ inventory: fresh, task: next, budget: freshBudget, deep: true }));
    }
    if (candidate.lineage.length !== tasks.length) throw enrichmentError('Recovery lineage omits a selected task.');
    await reconcilePublishedSemanticBindingWork({ repoRoot, userConfig, buildId: fresh.manifest.generation.baseBuildId,
      buildRoot: now.buildRoot, modes: ['code'], ...(Database !== undefined ? { Database } : {}) });
    for (const line of candidate.lineage) {
      const next = control.getTask(line.replannedTaskId);
      if (next?.state !== 'completed' || !control.getOutput(line.replannedTaskId)) throw enrichmentError('New publication acknowledgment is still pending.');
      const old = inventory.tasks.get(line.sourceTaskId);
      control.enqueue({ task: old, durableInputHashes: new Set(inventory.syntax.map(row => row.canonicalHash)) });
      control.supersede({ taskId: old.taskId, expectedInputHash: semanticTaskInputHash(old) });
    }
    journal = { ...candidate, status: 'reconciled', publishedGeneration: fresh.manifest.generation, publishedManifestHash: fresh.manifestHash, failure: null };
    await writeJournal(); result.status = 'recovered'; result.publishedGeneration = fresh.manifest.generation;
    result.lineage = candidate.lineage; result.tasks.forEach(row => { row.state = 'superseded'; });
    return true;
  };
  try {
    if (action === 'drain' && await recover(previous)) return boundedResult(result, limits);
    current = await budget.run(() => readEnrichmentCurrent({ repoRoot, userConfig }));
    if (current.buildRoot !== toRealPathSync(path.dirname(inventory.indexDir))) throw enrichmentError('Only the exact current source generation may be enqueued or drained.');
    await budget.run(() => verifyEnrichmentLiveSources({ repoRoot, inventory, budget }));
    for (const task of tasks) {
      await budget.run(() => verifyEnrichmentTask({ inventory, task, budget, deep: true }));
      const row = control.enqueue({ task, durableInputHashes: new Set(inventory.syntax.map(partition => partition.canonicalHash)) });
      result.tasks.find(value => value.taskId === task.taskId).state = row.state;
    }
    if (action === 'enqueue') { result.status = 'enqueued'; return boundedResult(result, limits); }
    for (const task of tasks) {
      const [lease] = control.leaseReady({ baseBuildId: generation.baseBuildId, taskId: task.taskId, owner,
        limit: 1, leaseMs: Math.max(60000, limits.drainMaxMs + 30000), dependencyHashes: authorities.get(task.taskId).dependencyHashes });
      if (!lease) { result.status = 'blocked'; result.diagnostics.push('task_not_ready_or_already_leased'); return boundedResult(result, limits); }
      leases.set(task.taskId, lease); result.tasks.find(value => value.taskId === task.taskId).state = 'leased';
    }
    journal = { schemaVersion: 1, requestId, sourceGeneration: generation, sourceManifestHash: inventory.manifestHash,
      sourcePointerHash: current.hash, taskIds: ids, status: 'prepared', lineage: [], publishedGeneration: null,
      publishedManifestHash: null, newBuildRoot: null, failure: null };
    await writeJournal();
    const leaseMs = Math.max(60000, limits.drainMaxMs + 30000);
    renewal = setInterval(() => {
      try { for (const taskId of leases.keys()) control.renew({ taskId, owner, leaseMs }); }
      catch (error) { child.abort(error); }
    }, Math.floor(leaseMs / 3)); renewal.unref?.();
    deadline = setTimeout(() => child.abort(enrichmentError('Manual drain deadline exhausted.', 'ERR_SEMANTIC_ENRICHMENT_BUDGET')), limits.drainMaxMs);
    deadline.unref?.();
    const drainBudget = createEnrichmentBudget(limits.drainMaxMs, child.signal);
    const grant = createSemanticEnrichmentGrant({ async attach(runtime) {
      if (toRealPathSync(runtime.root) !== toRealPathSync(repoRoot) || !runtime.semanticPolicy?.enabled
        || runtime.buildId === generation.baseBuildId) throw enrichmentError('Fresh drain runtime authority differs from its request.');
      journal.newBuildRoot = runtime.buildRoot; journal.publishedGeneration = { baseBuildId: runtime.buildId, semanticRevision: 0 };
      journal.status = 'building'; await writeJournal();
      return { maxMs: limits.drainMaxMs, phaseAllows: (phase, sourceUnitId) => tasks.some(task =>
        (task.kind === phase || task.coverageToProduce.includes(phase)) && task.sourceUnits.includes(sourceUnitId)),
      async admitTask({ task }) {
        drainBudget.check();
        const old = tasks.find(value => sameTaskInputs(value, task));
        if (!old) return false;
        if (!await verifyAuthority(old, 'before-work', drainBudget.signal)) throw enrichmentError('Original dependency authority changed before execution.');
        if (task.baseBuildId !== runtime.buildId || task.taskId === old.taskId) throw enrichmentError('Replanned task must retain a distinct fresh generation identity.');
        control.renew({ taskId: old.taskId, owner, leaseMs });
        const line = { sourceTaskId: old.taskId, replannedTaskId: task.taskId, inputHash: semanticTaskInputHash(old), policyHash: old.policyHash };
        if (journal.lineage.some(value => value.sourceTaskId === old.taskId && !enrichmentSame(value, line))) throw enrichmentError('Ambiguous old/new task lineage.');
        if (!journal.lineage.some(value => enrichmentSame(value, line))) journal.lineage.push(line);
        await writeJournal(); return true;
      },
      async beforePublish() {
        drainBudget.check();
        const live = await readEnrichmentCurrent({ repoRoot, userConfig });
        if (live.hash !== current.hash || live.buildRoot !== current.buildRoot) throw enrichmentError('Current source generation changed during drain.');
        await drainBudget.run(() => verifyEnrichmentLiveSources({ repoRoot, inventory, budget: drainBudget }));
        if (journal.lineage.length !== tasks.length) throw enrichmentError('Fresh builder did not admit every selected immutable task.');
        const fresh = await drainBudget.run(() => openEnrichmentInventory({ repoRoot, userConfig,
          generation: journal.publishedGeneration, indexDir: path.join(runtime.buildRoot, 'index-code'), budget: drainBudget }));
        if (!enrichmentSame(syntaxInventory(fresh), syntaxInventory(inventory))) throw enrichmentError('Fresh generation source facts changed; old tasks cannot be retargeted.');
        for (const line of journal.lineage) {
          const old = inventory.tasks.get(line.sourceTaskId), next = fresh.tasks.get(line.replannedTaskId);
          if (!await verifyAuthority(old, 'before-publication', drainBudget.signal)) throw enrichmentError('Original dependency authority changed before publication.');
          if (!next || !sameTaskInputs(old, next) || !fresh.manifest.completedTasks?.some(receipt => receipt.taskId === next.taskId
              && receipt.inputHash === line.inputHash && receipt.policyHash === line.policyHash)) throw enrichmentError('Fresh drain output is incomplete for the selected task inputs.');
          await drainBudget.run(() => verifyEnrichmentTask({ inventory: fresh, task: next, budget: drainBudget, deep: true }));
          control.renew({ taskId: old.taskId, owner, leaseMs });
        }
        journal.publishedManifestHash = fresh.manifestHash; await writeJournal();
      } };
    } });
    if (!build) build = (await import('../integrations/core/build-index/index.js')).buildIndex;
    drainBudget.check();
    await build(repoRoot, { mode: 'code', stage: 'stage2', incremental: true, rawArgv: [],
      semanticEnrichmentDrain: grant, abortSignal: child.signal });
    if (!await recover(journal)) throw enrichmentError('Normal builder did not publish the exact verified drain generation.');
    result.status = 'published'; return boundedResult(result, limits);
  } catch (error) {
    primaryFailure = error;
    if (journal) {
      journal.failure = error.code || error.message;
      journal.status = 'failed';
      try {
        const committed = await readEnrichmentCurrent({ repoRoot, userConfig });
        if (journal.newBuildRoot && committed.buildRoot === toRealPathSync(journal.newBuildRoot)) journal.status = 'published';
      } catch {}
      try { await writeJournal(); } catch {}
    }
    throw error;
  } finally {
    if (renewal) clearInterval(renewal); if (deadline) clearTimeout(deadline);
    signal?.removeEventListener('abort', abort);
    let cleanupFailure = null;
    for (const taskId of leases.keys()) {
      try {
        const row = control.getTask(taskId);
        if (row?.state === 'leased' && row.leaseOwner === owner && row.leaseUntil > Date.now()) {
          control.release({ taskId, owner, reason: 'manual_drain_not_acknowledged', transient: true });
        }
      } catch (error) { if (error.code !== 'ERR_SEMANTIC_LEASE_LOST') cleanupFailure ||= error; }
    }
    try { control.close(); } catch (error) { cleanupFailure ||= error; }
    if (!primaryFailure && cleanupFailure) throw cleanupFailure;
  }
};
