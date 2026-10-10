import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';
import { assertSemanticTask } from '../../contracts/validators/semantic-task.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { isWithinRoot, toRealPathSync } from '../../workspace/identity.js';
import { createArtifactSemanticStore, resolveSemanticPartPath } from '../../semantic/artifact-store.js';
import { openPublishedSemanticStore } from '../../semantic/published-store.js';
import { loadPiecesManifest } from '../../shared/artifact-io/manifest-read.js';
import { checksumFile } from '../../shared/hash.js';
import { getRepoCacheRoot, getBuildsRoot, getToolingConfig } from '../../shared/dict-utils.js';
import { throwIfAborted } from '../../shared/abort.js';
import { createSemanticCacheDependencySignatures } from '../build/incremental/semantic-cache-dependencies.js';
import { canonicalSemanticJson, semanticHash, createSemanticTaskId, createAnalysisPartitionId } from './identity.js';
import { createSemanticFactsRef } from './file-ref.js';
import { validateSemanticPartitions } from './reconcile.js';
import { writeSemanticAnalysis } from './analysis-write.js';
import { openSemanticFrontier, semanticTaskInputHash } from './frontier.js';

const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (message, code = 'ERR_SEMANTIC_BINDING_WORK') => Object.assign(new Error(message), { code });
const ordered = list => [...list].sort((a, b) => a.localeCompare(b));
const databaseFor = async runtime => {
  if (Object.hasOwn(runtime, 'semanticFrontierDatabase')) return runtime.semanticFrontierDatabase;
  try { return (await import('better-sqlite3')).default; }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') return null; throw error; }
};
const openControl = async runtime => {
  const Database = await databaseFor(runtime);
  const filename = path.join(runtime.repoCacheRoot || getRepoCacheRoot(runtime.root, runtime.userConfig || {}), 'semantic-frontier', 'control.sqlite');
  if (typeof Database !== 'function') return { available: false, reason: 'sqlite_control_store_unavailable' };
  await fs.mkdir(path.dirname(filename), { recursive: true });
  return openSemanticFrontier({ Database, filename, maxAttempts: runtime.semanticPolicy.execution.maxAttempts });
};
const writeTargetSet = async ({ root, targetSet, targetSetHash, diskAccount, signal }) => {
  const bytes = Buffer.from(canonicalSemanticJson(targetSet) + '\n');
  const relative = 'semantic-frontier-targets/' + targetSetHash + '.json';
  const directory = path.join(root, 'semantic-frontier-targets');
  await fs.mkdir(directory, { recursive: true });
  await resolveSemanticPartPath(root, 'semantic-frontier-targets');
  const filename = path.join(root, relative);
  let handle = null, reserved = false;
  try {
    throwIfAborted(signal);
    handle = await fs.open(filename, 'wx');
    diskAccount.reserve(bytes.length); reserved = true;
    await handle.writeFile(bytes); await handle.sync();
    throwIfAborted(signal);
  } catch (error) {
    if (handle) { await handle.close(); handle = null; await fs.rm(filename, { force: true }); }
    if (reserved) diskAccount.release(bytes.length);
    if (error.code !== 'EEXIST' || !(await fs.readFile(await resolveSemanticPartPath(root, relative))).equals(bytes)) throw error;
  } finally { if (handle) await handle.close(); }
  return { path: relative, hash: hashBytes(bytes), bytes: bytes.length };
};
const readTargetSet = async ({ root, task, generation, syntaxPartitions }) => {
  if (task.targetsRef !== 'semantic-frontier-targets/' + task.targetSetHash + '.json') throw fail('Task target-set reference mismatch.');
  const filename = await resolveSemanticPartPath(root, task.targetsRef);
  if ((await fs.stat(filename)).size > 32 * 1024 * 1024) throw fail('Task target set exceeds descriptor allowance.');
  const target = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (Object.keys(target).some(key => !['schemaVersion', 'generation', 'sourceUnits', 'syntaxPartitionRefs'].includes(key))
    || target.schemaVersion !== 1 || canonicalSemanticJson(target.generation) !== canonicalSemanticJson(generation)
    || semanticHash('pairofcleats.semantic.binding-targets.v1', target) !== task.targetSetHash
    || canonicalSemanticJson(target.sourceUnits) !== canonicalSemanticJson(ordered(task.sourceUnits))
    || !Array.isArray(target.syntaxPartitionRefs) || target.syntaxPartitionRefs.length !== task.sourceUnits.length
    || target.syntaxPartitionRefs.some(ref => Object.keys(ref).length !== 3 || !syntaxPartitions.some(partition =>
      partition.partitionId === ref.partitionId && partition.canonicalHash === ref.canonicalHash && partition.sourceUnitId === ref.sourceUnitId))) {
    throw fail('Task targets differ from the exact durable generation/source inventory.');
  }
  return target;
};

/** One generation-pinned bind task. Existing scheduler owns execution; immutable files own recovery. */
export const prepareSemanticBindingWork = async ({ state, runtime, signal = null }) => {
  const policy = runtime.semanticPolicy;
  const notRun = reason => ({ ran: false, reason });
  if (!policy?.enabled || policy.enrichment.bindings === 'off') return { task: null, status: 'disabled', run: async () => notRun('bindings_disabled') };
  throwIfAborted(signal);
  const entries = [...(state.semanticFactsByFile || [])].sort(([, a], [, b]) => a.sourceUnitId.localeCompare(b.sourceUnitId));
  if (!entries.length) return { task: null, status: 'empty', run: async () => notRun('no_source_facts') };
  const generation = entries[0][1].storage.generation;
  const root = path.join(runtime.buildRoot, entries[0][1].storage.relativePath);
  const syntaxPartitions = [], sources = new Map();
  for (const [file, entry] of entries) {
    assertSemanticEnvelope('fileFactsRef', entry);
    if (canonicalSemanticJson(entry.storage.generation) !== canonicalSemanticJson(generation)
      || path.resolve(runtime.buildRoot, entry.storage.relativePath) !== path.resolve(root)) throw fail('Mixed semantic binding target generations or roots.');
    const partition = entry.partitions.find(row => row.partitionId === entry.syntaxPartitionId);
    syntaxPartitions.push(partition);
    const store = createArtifactSemanticStore({ root, repoRoot: runtime.root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation, partitions: [partition] });
    for await (const source of store.iterateRows(partition.partitionId, 'semantic_sources', { signal })) sources.set(file, source);
  }
  const store = createArtifactSemanticStore({ root, repoRoot: runtime.root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation, partitions: syntaxPartitions });
  await validateSemanticPartitions({ store, partitions: syntaxPartitions, signal });
  const eligible = entries.filter(([file]) => ['javascript', 'typescript'].includes(sources.get(file)?.language) && (!sources.get(file).mapping || sources.get(file).mapping.quality === 'exact'));
  if (!eligible.length) return { task: null, status: 'unsupported', run: async () => notRun('no_supported_binding_sources') };
  const eligibleSyntax = eligible.map(([, entry]) => syntaxPartitions.find(row => row.partitionId === entry.syntaxPartitionId));
  const sourceUnits = ordered(eligible.map(([, entry]) => entry.sourceUnitId));
  const targetSet = { schemaVersion: 1, generation, sourceUnits,
    syntaxPartitionRefs: eligibleSyntax.map(({ partitionId, canonicalHash, sourceUnitId }) => ({ partitionId, canonicalHash, sourceUnitId }))
      .sort((a, b) => a.partitionId.localeCompare(b.partitionId)) };
  const targetSetHash = semanticHash('pairofcleats.semantic.binding-targets.v1', targetSet);
  const dependencySignatures = createSemanticCacheDependencySignatures({ dependencySignatures: { tooling: getToolingConfig(runtime.root) }, policy, root: runtime.root });
  const policyHash = semanticHash('pairofcleats.semantic.binding-task-policy.v1', { version: 1, dependencySignatures,
    bindings: policy.enrichment.bindings, localFlow: policy.enrichment.localFlow, boundaryModels: policy.enrichment.boundaryModels || null });
  const inputHashes = ordered([...new Set(eligibleSyntax.map(row => row.canonicalHash))]);
  const task = assertSemanticTask({ schemaVersion: 1, taskId: createSemanticTaskId({ kind: 'bind', inputHashes, policyHash, targetSetHash }),
    kind: 'bind', baseBuildId: generation.baseBuildId, sourceUnits, inputHashes, policyHash, targetSetHash,
    targetsRef: 'semantic-frontier-targets/' + targetSetHash + '.json', dependencies: [], priority: 1,
    reason: 'generation_pinned_binding_pass', coverageToProduce: ['bindings'] });
  const targetInventory = await writeTargetSet({ root, targetSet, targetSetHash, diskAccount: state.semanticDiskAccount, signal });
  state.semanticFrontierTargets ||= [];
  if (!state.semanticFrontierTargets.some(row => row.path === targetInventory.path)) state.semanticFrontierTargets.push(targetInventory);
  const [primaryFile, original] = eligible[0], source = sources.get(primaryFile);
  const taskPartitionId = createAnalysisPartitionId({ pass: { name: 'semantic-binding-frontier', version: '1' },
    inputPartitionHashes: inputHashes, compilerContext: null, dependencySummaryHashes: [], analysisPolicy: { targetSetHash, policyHash } });
  if (!original.partitions.some(row => row.partitionId === taskPartitionId)) {
    const coverage = { scope: { sourceUnitId: source.sourceUnitId }, phase: 'bindings', state: 'deferred',
      reason: 'generation_pinned_binding_task', observedCount: null, completedCount: 0, frontierRef: task.taskId };
    const partition = await writeSemanticAnalysis({ policy, stagingRoot: root, source,
      sourceBytes: await fs.readFile(path.join(root, 'semantic-sources', source.byteHash + '.utf8')),
      partitionId: taskPartitionId, producerHash: semanticHash('pairofcleats.semantic.binding-frontier-producer.v1', { version: 1 }),
      policyHash, diskAccount: state.semanticDiskAccount, signal,
      rows: [{ family: 'frontier', row: task }, { family: 'coverage', row: coverage }] });
    state.semanticFactsByFile.set(primaryFile, createSemanticFactsRef({ source, storage: original.storage,
      syntaxPartitionId: original.syntaxPartitionId, partitions: [...original.partitions, partition], coverage: [...original.coverage, coverage] }));
  }
  const durableInputHashes = new Set(syntaxPartitions.map(row => row.canonicalHash));
  let control = await openControl(runtime);
  try { if (control.available) control.enqueue({ task, durableInputHashes }); } finally { control.close?.(); }
  let claimed = false;
  return { task, status: 'pending', async run(fn) {
    if (claimed) return notRun('binding_task_already_admitted');
    claimed = true;
    throwIfAborted(signal);
    if (policy.enrichment.bindings === 'deferred' && policy.execution.deferredDrain !== 'after-index') return notRun('manual_deferred_binding_task');
    if (typeof runtime.scheduler?.schedule !== 'function') return notRun('existing_relations_scheduler_unavailable');
    const maxMs = policy.enrichment.bindings === 'deferred' ? policy.execution.afterIndexMaxMs : null;
    if (maxMs === 0) return notRun('after_index_budget_exhausted');
    control = await openControl(runtime);
    if (!control.available) return notRun('sqlite_control_store_unavailable');
    const owner = 'build:' + task.taskId;
    const child = new AbortController(), started = Date.now();
    const onAbort = () => child.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    let deadline = false, lease = null;
    let renewal = null;
    const leaseMs = Math.max(60000, (maxMs || 0) + 30000);
    const checkDeadline = () => {
      if (maxMs !== null && Date.now() - started >= maxMs) { deadline = true; child.abort(); }
      throwIfAborted(child.signal);
    };
    const timer = maxMs === null ? null : setTimeout(() => { deadline = true; child.abort(); }, maxMs);
    timer?.unref?.();
    try {
      [lease] = control.leaseReady({ baseBuildId: task.baseBuildId, taskId: task.taskId, owner,
        limit: 1, leaseMs });
      if (!lease) return notRun('binding_task_not_ready');
      renewal = setInterval(() => {
        try { control.renew({ taskId: task.taskId, owner, leaseMs }); }
        catch { child.abort(); }
      }, Math.floor(leaseMs / 3));
      renewal.unref?.();
      const output = await runtime.scheduler.schedule('relations', { cpu: 1, io: 1, mem: 1,
        bytes: policy.storage.batchBytes, signal: child.signal }, () => {
        throwIfAborted(child.signal);
        return fn({ signal: child.signal });
      });
      checkDeadline();
      assertSemanticEnvelope('provider', output);
      const currentPartitions = [...state.semanticFactsByFile.values()].flatMap(entry => entry.partitions);
      const currentStore = createArtifactSemanticStore({ root, repoRoot: runtime.root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation, partitions: currentPartitions });
      await validateSemanticPartitions({ store: currentStore, partitions: currentPartitions, signal: child.signal });
      const completedSources = new Set();
      for (const partition of output.partitions) {
        if (!currentPartitions.some(current => current.partitionId === partition.partitionId && current.canonicalHash === partition.canonicalHash)) throw fail('Binding output is not durable in this generation.');
        for await (const coverage of currentStore.iterateRows(partition.partitionId, 'semantic_coverage', { signal: child.signal })) {
          if (coverage.phase === 'bindings' && ['complete', 'partial'].includes(coverage.state)) completedSources.add(partition.sourceUnitId);
        }
      }
      if (sourceUnits.some(id => !completedSources.has(id))) {
        control.release({ taskId: task.taskId, owner, reason: 'binding_source_inventory_incomplete', transient: true });
        return notRun('binding_source_inventory_incomplete');
      }
      checkDeadline();
      // Receipt creation itself requires the exact live attempt, even when a
      // synchronous compiler slice prevented a renewal timer from firing.
      control.renew({ taskId: task.taskId, owner, leaseMs });
      const receipt = { taskId: task.taskId, baseBuildId: task.baseBuildId, inputHash: semanticTaskInputHash(task), policyHash: task.policyHash };
      state.semanticCompletedTasks ||= [];
      if (!state.semanticCompletedTasks.some(row => row.taskId === task.taskId)) state.semanticCompletedTasks.push(receipt);
      return { ran: true, output, receipt, elapsedMs: Date.now() - started, planningBudgetMs: policy.planning.inlineBudgetMs };
    } catch (error) {
      if (lease) {
        try { control.release({ taskId: task.taskId, owner, reason: deadline ? 'after_index_budget_exhausted' : error.code || error.message,
          transient: deadline || error.transient === true, cancelled: signal?.aborted === true }); }
        catch (releaseError) { if (releaseError.code !== 'ERR_SEMANTIC_LEASE_LOST') throw releaseError; }
      }
      if (deadline && !signal?.aborted) return notRun('after_index_budget_exhausted');
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      if (renewal) clearInterval(renewal);
      signal?.removeEventListener('abort', onAbort); control.close();
    }
  } };
};

/** Recovery only after the normal pointer commit. Pending source-only generations remain pending. */
export const reconcilePublishedSemanticBindingWork = async ({ repoRoot, userConfig = {}, buildId, buildRoot, modes = ['code'], Database }) => {
  const existingModes = [];
  for (const mode of modes) {
    try { await fs.access(path.join(buildRoot, 'index-' + mode, 'semantic_manifest.json')); existingModes.push(mode); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!existingModes.length) return { status: 'empty', recovered: 0, pending: 0 };
  const runtime = { root: repoRoot, repoCacheRoot: getRepoCacheRoot(repoRoot, userConfig), userConfig,
    semanticPolicy: { execution: { maxAttempts: 3 } } };
  if (Database !== undefined) runtime.semanticFrontierDatabase = Database;
  let control = null;
  let recovered = 0, pending = 0;
  try {
    for (const mode of existingModes) {
      const indexDir = path.join(buildRoot, 'index-' + mode), manifestPath = path.join(indexDir, 'semantic_manifest.json');
      try { await fs.access(manifestPath); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const generation = { baseBuildId: buildId, semanticRevision: 0 };
      const { store, manifest } = await openPublishedSemanticStore({ indexDir, repoRoot, generation });
      await validateSemanticPartitions({ store, partitions: manifest.partitions });
      const pieces = loadPiecesManifest(indexDir, { repoRoot });
      const manifestBytes = await fs.readFile(manifestPath), manifestHash = hashBytes(manifestBytes);
      const registeredManifestHash = await checksumFile(manifestPath);
      if (!pieces.pieces.some(piece => piece.name === 'semantic_manifest'
        && piece.checksum === registeredManifestHash.algo + ':' + registeredManifestHash.value)) throw fail('Published semantic manifest checksum is not registered.');
      const tasks = new Map();
      for (const partition of manifest.partitions) for await (const task of store.iterateRows(partition.partitionId, 'semantic_frontier')) {
        assertSemanticTask(task);
        if (task.kind !== 'bind' || task.baseBuildId !== buildId) continue;
        await readTargetSet({ root: path.join(indexDir, 'semantic'), task, generation,
          syntaxPartitions: manifest.partitions.filter(row => row.partitionId.startsWith('sy1:')) });
        const targetPath = 'semantic/' + task.targetsRef;
        const targetFile = await resolveSemanticPartPath(indexDir, targetPath);
        const targetBytes = await fs.readFile(targetFile), targetChecksum = await checksumFile(targetFile);
        if (!pieces.pieces.some(piece => piece.name === 'semantic_frontier_targets' && piece.path === targetPath
          && piece.checksum === targetChecksum.algo + ':' + targetChecksum.value)
          || !manifest.frontierTargets?.some(target => target.path === task.targetsRef
            && target.hash === hashBytes(targetBytes) && target.bytes === targetBytes.length)) throw fail('Published target set is not registered.');
        tasks.set(task.taskId, task);
      }
      if (!tasks.size && !(manifest.completedTasks || []).length) continue;
      control ||= await openControl(runtime);
      if (!control.available) return { status: 'unavailable', recovered, pending: tasks.size };
      const durableInputHashes = new Set(manifest.partitions.map(row => row.canonicalHash));
      for (const task of tasks.values()) control.enqueue({ task, durableInputHashes });
      for (const receipt of manifest.completedTasks || []) {
        const task = tasks.get(receipt.taskId);
        if (!task || receipt.baseBuildId !== buildId || receipt.policyHash !== task.policyHash
          || receipt.inputHash !== semanticTaskInputHash(task)) throw fail('Completed binding receipt differs from the durable task.');
        const publication = { ...receipt, manifestHash, publishedBuildId: buildId };
        await control.reconcilePublished({ taskId: task.taskId, publication, verifyPublication: async () => {
          const current = JSON.parse(await fs.readFile(path.join(getBuildsRoot(repoRoot, userConfig), 'current.json'), 'utf8'));
          const relative = current.buildRootsByMode?.[mode] || (current.buildId === buildId ? current.buildRoot : null);
          if (current.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION || !relative) return false;
          const cacheRoot = toRealPathSync(runtime.repoCacheRoot);
          const publishedRoot = toRealPathSync(path.resolve(runtime.repoCacheRoot, relative));
          if (!isWithinRoot(publishedRoot, cacheRoot) || publishedRoot !== toRealPathSync(buildRoot)) return false;
          return hashBytes(await fs.readFile(manifestPath)) === manifestHash;
        } });
        recovered += 1;
      }
      pending += [...tasks.keys()].filter(id => control.getTask(id)?.state !== 'completed').length;
    }
    return { status: 'complete', recovered, pending };
  } finally { control?.close?.(); }
};

/** Persist deeper-analysis frontiers even when the base build elects not to run them. */
export const persistSemanticAnalysisFrontiers = async ({ state, runtime, signal = null }) => {
  const policy = runtime.semanticPolicy;
  if (!policy?.enabled) return [];
  const phases = ['localFlow', 'crossFileFlow'].filter(phase => policy.enrichment[phase] === 'deferred');
  if (!phases.length || !state.semanticFactsByFile?.size) return [];
  const entries = [...state.semanticFactsByFile].sort(([,a],[,b]) => a.sourceUnitId.localeCompare(b.sourceUnitId));
  const generation = entries[0][1].storage.generation, root = path.join(runtime.buildRoot, entries[0][1].storage.relativePath);
  const eligible = [], sources = new Map();
  for (const [file, descriptor] of entries) {
    throwIfAborted(signal);
    if (canonicalSemanticJson(descriptor.storage.generation) !== canonicalSemanticJson(generation)) throw fail('Mixed deferred analysis generations.');
    const syntax = descriptor.partitions.find(partition => partition.partitionId === descriptor.syntaxPartitionId);
    const store = createArtifactSemanticStore({ root, repoRoot: runtime.root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation, partitions: [syntax] });
    for await (const source of store.iterateRows(syntax.partitionId, 'semantic_sources', { signal })) {
      if (['javascript', 'typescript'].includes(source.language)) { eligible.push([file, descriptor, syntax]); sources.set(file, source); }
    }
  }
  if (!eligible.length) return [];
  const targetSet = { schemaVersion: 1, generation, sourceUnits: ordered(eligible.map(([,entry]) => entry.sourceUnitId)),
    syntaxPartitionRefs: eligible.map(([, , partition]) => ({ partitionId: partition.partitionId, canonicalHash: partition.canonicalHash, sourceUnitId: partition.sourceUnitId })).sort((a,b) => a.partitionId.localeCompare(b.partitionId)) };
  const targetSetHash = semanticHash('pairofcleats.semantic.binding-targets.v1', targetSet);
  const inventory = await writeTargetSet({ root, targetSet, targetSetHash, diskAccount: state.semanticDiskAccount, signal });
  state.semanticFrontierTargets ||= [];
  if (!state.semanticFrontierTargets.some(value => value.path === inventory.path)) state.semanticFrontierTargets.push(inventory);
  const inputHashes = ordered([...new Set(eligible.flatMap(([,entry]) => entry.partitions.map(partition => partition.canonicalHash)))]);
  const tasks = [];
  for (const phase of phases) {
    const policyHash = semanticHash('semantic.deferred-analysis-policy.v1', { phase, enrichment: policy.enrichment });
    const task = assertSemanticTask({ schemaVersion: 1, taskId: createSemanticTaskId({ kind: phase, inputHashes, policyHash, targetSetHash }),
      kind: phase, baseBuildId: generation.baseBuildId, sourceUnits: targetSet.sourceUnits, inputHashes, policyHash, targetSetHash,
      targetsRef: inventory.path, dependencies: [], priority: 1, reason: 'analysis_explicitly_deferred', coverageToProduce: [phase] });
    for (let index = 0; index < eligible.length; index += 1) {
      const [file] = eligible[index], source = sources.get(file), current = state.semanticFactsByFile.get(file);
      const partitionId = createAnalysisPartitionId({ pass: { name: 'semantic-analysis-frontier', version: '1' }, inputPartitionHashes: inputHashes,
        compilerContext: { sourceUnitId: source.sourceUnitId }, dependencySummaryHashes: [], analysisPolicy: { taskId: task.taskId } });
      const coverage = { scope: { sourceUnitId: source.sourceUnitId }, phase, state: 'deferred', reason: 'analysis_explicitly_deferred', observedCount: null, completedCount: 0, frontierRef: task.taskId };
      const partition = await writeSemanticAnalysis({ policy, stagingRoot: root, source,
        sourceBytes: await fs.readFile(path.join(root, 'semantic-sources', source.byteHash + '.utf8')), partitionId,
        producerHash: semanticHash('semantic.analysis-frontier-producer.v1', { version: 1 }), policyHash, diskAccount: state.semanticDiskAccount, signal,
        rows: [...(index === 0 ? [{ family: 'frontier', row: task }] : []), { family: 'coverage', row: coverage }] });
      state.semanticFactsByFile.set(file, createSemanticFactsRef({ source, syntaxPartitionId: current.syntaxPartitionId, storage: current.storage,
        partitions: [...current.partitions.filter(value => value.partitionId !== partitionId), partition], coverage: [...current.coverage.filter(value => value.phase !== phase), coverage] }));
    }
    const control = await openControl(runtime);
    try { if (control.available) control.enqueue({ task, durableInputHashes: new Set(inputHashes) }); }
    finally { control.close?.(); }
    tasks.push(task);
  }
  return tasks;
};
