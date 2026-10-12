import { retainSemanticBytes } from './disk-writes.js';
import { assertCompilerTaskAuthority, collectCompilerDependencyInventory, compilerInventoryHash, COMPILER_DEPENDENCY_KEY } from './compiler-dependencies.js';
import { resolveSemanticSourcePolicy, validateSemanticSourceTargets } from './policy.js';
import { planSemanticSource } from './planning.js';
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
import { runSemanticTaskBatch } from './frontier-execution.js';
import { semanticTaskInputHash } from './frontier.js';
import { openSemanticControlStore } from './control-store.js';
import { reopenSemanticDiskAccount } from '../build/incremental/working-set.js';
import { normalizeSemanticConfig } from './config.js';

const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (message, code = 'ERR_SEMANTIC_BINDING_WORK') => Object.assign(new Error(message), { code });
const ordered = list => [...list].sort((a, b) => a.localeCompare(b));
const databaseFor = async runtime => {
  if (Object.hasOwn(runtime, 'semanticFrontierDatabase')) return runtime.semanticFrontierDatabase;
  try { return (await import('better-sqlite3')).default; }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') return null; throw error; }
};
export const openRepositorySemanticControl = async (runtime, diskAccount = null, signal = null) => {
  const Database = await databaseFor(runtime);
  const cacheRoot = runtime.repoCacheRoot || getRepoCacheRoot(runtime.root, runtime.userConfig || {});
  const filename = path.join(cacheRoot, 'semantic-frontier', 'control.sqlite');
  if (typeof Database !== 'function') return { available: false, reason: 'sqlite_control_store_unavailable' };
  diskAccount ||= (await reopenSemanticDiskAccount({
    limit: runtime.semanticPolicy?.storage?.maxDiskWorkingSetBytes
      ?? normalizeSemanticConfig(runtime.userConfig?.indexing?.semantic).storage.maxDiskWorkingSetBytes,
    roots: [cacheRoot], signal
  })).account;
  const reconstruct = async controlStore => {
    const current = JSON.parse(await fs.readFile(path.join(getBuildsRoot(runtime.root, runtime.userConfig || {}), 'current.json'), 'utf8'));
    if (current.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION) throw fail('Invalid recovery publication.');
    let verified = false;
    for (const mode of current.modes || ['code']) {
      const relative = current.buildRootsByMode?.[mode] || current.buildRoot;
      if (!relative) continue;
      const buildRoot = toRealPathSync(path.resolve(cacheRoot, relative));
      if (!isWithinRoot(buildRoot, toRealPathSync(cacheRoot))) throw fail('Recovery publication escapes cache.');
      const manifest = JSON.parse(await fs.readFile(path.join(buildRoot, 'index-' + mode, 'semantic_manifest.json'), 'utf8'));
      const result = await reconcilePublishedSemanticBindingWork({ repoRoot: runtime.root, userConfig: runtime.userConfig,
        buildId: manifest.generation.baseBuildId, buildRoot, modes: [mode], Database, signal, controlStore, diskAccount });
      verified ||= result.recovered + result.pending > 0;
    }
    if (!verified) throw fail('Control repair requires published semantic tasks.', 'ERR_SEMANTIC_PUBLICATION_REQUIRED');
  };
  return openSemanticControlStore({ Database, filename, diskAccount, reconstruct, signal,
    maxAttempts: runtime.semanticPolicy?.execution?.maxAttempts ?? 3 });
};
const openControl = openRepositorySemanticControl;
const writeTargetSet = async ({ root, targetSet, targetSetHash, diskAccount, signal }) => {
  const bytes = Buffer.from(canonicalSemanticJson(targetSet) + '\n');
  if (bytes.length > 32 * 1024 * 1024) throw fail('Task target descriptor exceeds its allowance.');
  const relative = 'semantic-frontier-targets/' + targetSetHash + '.json';
  const directory = path.join(root, 'semantic-frontier-targets');
  await fs.mkdir(directory, { recursive: true });
  await resolveSemanticPartPath(root, 'semantic-frontier-targets');
  const filename = path.join(root, relative);
  await retainSemanticBytes({ filename, bytes, diskAccount, signal });
  return { path: relative, hash: hashBytes(bytes), bytes: bytes.length };
};
const readTargetSet = async ({ root, task, generation, syntaxPartitions }) => {
  if (task.targetsRef !== 'semantic-frontier-targets/' + task.targetSetHash + '.json') throw fail('Task target-set reference mismatch.');
  const filename = await resolveSemanticPartPath(root, task.targetsRef);
  if ((await fs.stat(filename)).size > 32 * 1024 * 1024) throw fail('Task target set exceeds descriptor allowance.');
  const target = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (Object.keys(target).some(key => !['schemaVersion', 'generation', 'sourceUnits', 'syntaxPartitionRefs', 'compilerInventory'].includes(key))
    || target.schemaVersion !== 1 || canonicalSemanticJson(target.generation) !== canonicalSemanticJson(generation)
    || semanticHash('pairofcleats.semantic.binding-targets.v1', target) !== task.targetSetHash
    || canonicalSemanticJson(target.sourceUnits) !== canonicalSemanticJson(ordered(task.sourceUnits))
    || !Array.isArray(target.syntaxPartitionRefs) || target.syntaxPartitionRefs.length !== task.sourceUnits.length
    || target.syntaxPartitionRefs.some(ref => Object.keys(ref).length !== 3 || !syntaxPartitions.some(partition =>
      partition.partitionId === ref.partitionId && partition.canonicalHash === ref.canonicalHash && partition.sourceUnitId === ref.sourceUnitId))) {
    throw fail('Task targets differ from the exact durable generation/source inventory.');
  }
  assertCompilerTaskAuthority(task, target);
  return target;
};

/** Freeze task inputs before leasing; the shared Program executes one admitted phase batch. */
const prepareBindingGroup = async ({ state, runtime, policy, kind = 'bind', phase = 'bindings', entriesOverride, signal = null }) => {
  const entries = [...(entriesOverride || state.semanticFactsByFile || [])].sort(([, a], [, b]) => a.sourceUnitId.localeCompare(b.sourceUnitId));
  if (!entries.length) return {task:null,status:'empty'};
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
  if (!eligible.length) return { task: null, status: 'unsupported' };
  const eligibleSyntax = eligible.map(([, entry]) => syntaxPartitions.find(row => row.partitionId === entry.syntaxPartitionId));
  const sourceUnits = ordered(eligible.map(([, entry]) => entry.sourceUnitId));

  let compilerInventory = null, dependencyFailure = null;
  try {
    state.semanticCompilerPreflight ||= collectCompilerDependencyInventory({ repoRoot: runtime.root, toolingConfig: getToolingConfig(runtime.root),
      files: state.semanticCompilerSourceInputs.map(source => source.path), sourceInputs: state.semanticCompilerSourceInputs,
      documents: state.semanticCompilerDocuments || [], signal });
    compilerInventory = await state.semanticCompilerPreflight;
  } catch (error) {
    throwIfAborted(signal); if (error.code !== 'ERR_SEMANTIC_DEPENDENCY_UNSEALED') throw error;
    dependencyFailure = error.message;
  }
  const authorityHash = compilerInventory ? compilerInventoryHash(compilerInventory) : null;
  const targetSet = { schemaVersion: 1, generation, sourceUnits, compilerInventory,
    syntaxPartitionRefs: eligibleSyntax.map(({ partitionId, canonicalHash, sourceUnitId }) => ({ partitionId, canonicalHash, sourceUnitId })).sort((a,b) => a.partitionId.localeCompare(b.partitionId)) };
  const targetSetHash = semanticHash('pairofcleats.semantic.binding-targets.v1', targetSet);
  const dependencySignatures = createSemanticCacheDependencySignatures({ dependencySignatures: { tooling: getToolingConfig(runtime.root) }, policy, root: runtime.root });
  const policyHash = semanticHash('pairofcleats.semantic.compiler-task-policy.v1', { version: 2, kind, dependencySignatures,
    authorityHash, effectiveAnalysis: policy.identity?.analysis || null, enrichment: policy.enrichment });
  const inputHashes = ordered([...new Set(eligibleSyntax.map(row => row.canonicalHash))]);
  const prerequisiteDisabled = kind !== 'bind' && policy.enrichment.bindings === 'off' || kind === 'crossFileFlow' && policy.enrichment.localFlow === 'off';
  const reason = !compilerInventory ? 'compiler_dependency_unavailable' : prerequisiteDisabled ? 'analysis_dependency_disabled' : 'generation_pinned_compiler_pass';
  const task = assertSemanticTask({ schemaVersion: 1, taskId: createSemanticTaskId({ kind, inputHashes, policyHash, targetSetHash }),
    kind, baseBuildId: generation.baseBuildId, sourceUnits, inputHashes, policyHash, targetSetHash,
    targetsRef: 'semantic-frontier-targets/' + targetSetHash + '.json', dependencies: authorityHash ? [{ dependencyKey: COMPILER_DEPENDENCY_KEY, expectedHash: authorityHash }] : [],
    priority: 1, reason, coverageToProduce: [phase] });
  const targetInventory = await writeTargetSet({ root, targetSet, targetSetHash, diskAccount: state.semanticDiskAccount, signal });
  state.semanticFrontierTargets ||= [];
  if (!state.semanticFrontierTargets.some(row => row.path === targetInventory.path)) state.semanticFrontierTargets.push(targetInventory);
  for (let index = 0; index < eligible.length; index++) {
    const [file] = eligible[index], source = sources.get(file), original = state.semanticFactsByFile.get(file);
    const partitionId = createAnalysisPartitionId({ pass: { name: 'semantic-compiler-frontier', version: '2' }, inputPartitionHashes: inputHashes,
      compilerContext: { sourceUnitId: source.sourceUnitId }, dependencySummaryHashes: [], analysisPolicy: { taskId: task.taskId } });
    if (original.partitions.some(row => row.partitionId === partitionId)) continue;
    const coverage = { scope: { sourceUnitId: source.sourceUnitId }, phase, state: prerequisiteDisabled ? 'disabled' : 'deferred',
      reason: dependencyFailure ? reason + ':' + dependencyFailure : reason, observedCount: null, completedCount: 0, frontierRef: task.taskId };
    const partition = await writeSemanticAnalysis({ policy, stagingRoot: root, source,
      sourceBytes: await fs.readFile(path.join(root,'semantic-sources',source.byteHash + '.utf8')), partitionId,
      producerHash: semanticHash('semantic.compiler-frontier-producer.v1',{version:2}), policyHash, diskAccount: state.semanticDiskAccount, signal,
      rows: [...(index === 0 ? [{family:'frontier',row:task}] : []), {family:'coverage',row:coverage}] });
    state.semanticFactsByFile.set(file,createSemanticFactsRef({source,storage:original.storage,syntaxPartitionId:original.syntaxPartitionId,
      partitions:[...original.partitions,partition],coverage:[...original.coverage,coverage]}));
  }
  const control = await openControl(runtime, state.semanticDiskAccount, signal);
  try { if (control.available) control.enqueue({task,durableInputHashes:new Set(inputHashes)}); } finally { control.close?.(); }
  let admitted = null;
  const admit = async () => {
    if (admitted !== null) return admitted;
    if (!compilerInventory || prerequisiteDisabled) return admitted = false;
    const drain = runtime.semanticEnrichmentDrain;
    return admitted = drain ? await drain.admitTask({task,targetSet}) === true
      : policy.executionMode !== 'deferred' || policy.execution.deferredDrain === 'after-index';
  };
  return {task,policy,phase,root,generation,compilerInventory,targetSet,admit};
};

/** Source policy groups stage independent immutable tasks, then share one admitted tooling pass. */
export const prepareSemanticBindingWork = async ({ state, runtime, signal = null, reuseReady = false, compilerDocuments = [] }) => {
  const base = runtime.semanticPolicy;
  if (!base?.enabled || !state.semanticFactsByFile?.size) return { task: null, tasks: [], status: 'disabled', run: async () => ({ ran: false, reason: 'bindings_disabled' }) };
  const entries = [...state.semanticFactsByFile], groups = new Map();
  state.semanticPlanningBySource ||= new Map();
  state.semanticCompilerSourceInputs = [];
  state.semanticCompilerPreflight = null;
  state.semanticCompilerDocuments = compilerDocuments;
  for (const [file, descriptor] of entries) {
    throwIfAborted(signal);
    const syntax = descriptor.partitions.find(partition => partition.partitionId === descriptor.syntaxPartitionId);
    const root = path.join(runtime.buildRoot, descriptor.storage.relativePath);
    const store = createArtifactSemanticStore({ root, repoRoot: runtime.root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: descriptor.storage.generation, partitions: [syntax] });
    for await (const source of store.iterateRows(syntax.partitionId, 'semantic_sources', { signal })) {
      if (['javascript', 'typescript'].includes(source.language)) {
        state.semanticCompilerSourceInputs.push({ path: source.path, sourceUnitId: source.sourceUnitId, byteHash: source.byteHash, textHash: source.textHash });
      }
      const sourcePath = source.mapping ? entries.find(([, parent]) => parent.sourceUnitId === source.mapping.parentSourceUnitId)?.[0] || source.path : source.path;
      const policy = resolveSemanticSourcePolicy(base, { sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, language: source.language, path: sourcePath });
      await validateSemanticSourceTargets(policy, { source, partitionId: syntax.partitionId, store, signal });
      const plan = planSemanticSource(policy, { sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, syntaxPartitionId: syntax.partitionId, reuseReady, metrics: { ...runtime.semanticAnalysisMeasurements?.get?.(source.sourceUnitId), nodes: syntax.members.semantic_records.reduce((sum, part) => sum + part.count, 0), operands: syntax.members.semantic_operands.reduce((sum, part) => sum + part.count, 0) } });
      state.semanticPlanningBySource.set(source.sourceUnitId, plan);
      if (!policy.languages.includes(source.language) || !['javascript','typescript'].includes(source.language)
        || source.mapping && source.mapping.quality !== 'exact' || policy.targetSelectionConfigured && !policy.targets.length) continue;
      for (const [kind,phase] of [['bind','bindings'],['localFlow','localFlow'],['crossFileFlow','crossFileFlow']]) {
        if (plan.modes[phase] === 'off') continue;
        const effective = {...policy,executionMode:plan.modes[phase]};
        const key = semanticHash('semantic.compiler-policy-group.v1',{kind,analysis:policy.identity.analysis,mode:plan.modes[phase],execution:policy.execution});
        if (!groups.has(key)) groups.set(key,{kind,phase,policy:effective,entries:[]});
        groups.get(key).entries.push([file,descriptor]);
      }
    }
  }
  const work = [];
  for (const group of groups.values()) work.push(await prepareBindingGroup({ state, runtime, signal, ...group, entriesOverride: group.entries }));
  state.semanticPhaseWorkPrepared = true;
  state.semanticPhaseTasks = work.map(item => item.task).filter(Boolean);
  return { task:work[0]?.task || null,tasks:state.semanticPhaseTasks,status:work.length?'pending':'empty',async run(fn) {
    const selected=[];
    for (const item of work) if(item.task && await item.admit()) selected.push(item);
    return runSemanticTaskBatch({state,runtime,selected,signal,fn,openControl:()=>openControl(runtime, state.semanticDiskAccount, signal)});
  }};
};

/** Recovery only after the normal pointer commit. Pending source-only generations remain pending. */
export const reconcilePublishedSemanticBindingWork = async ({ repoRoot, userConfig = {}, buildId, buildRoot, modes = ['code'], Database, signal = null, controlStore = null, diskAccount = null }) => {
  throwIfAborted(signal);
  const existingModes = [];
  for (const mode of modes) {
    try { await fs.access(path.join(buildRoot, 'index-' + mode, 'semantic_manifest.json')); existingModes.push(mode); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!existingModes.length) return { status: 'empty', recovered: 0, pending: 0 };
  const runtime = { root: repoRoot, repoCacheRoot: getRepoCacheRoot(repoRoot, userConfig), userConfig,
    semanticPolicy: { execution: { maxAttempts: 3 } } };
  if (Database !== undefined) runtime.semanticFrontierDatabase = Database;
  let control = controlStore;
  let recovered = 0, pending = 0;
  try {
    for (const mode of existingModes) {
      throwIfAborted(signal);
      const indexDir = path.join(buildRoot, 'index-' + mode), manifestPath = path.join(indexDir, 'semantic_manifest.json');
      try { await fs.access(manifestPath); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const generation = { baseBuildId: buildId, semanticRevision: 0 };
      const { store, manifest } = await openPublishedSemanticStore({ indexDir, repoRoot, generation });
      await validateSemanticPartitions({ store, partitions: manifest.partitions, signal });
      const pieces = loadPiecesManifest(indexDir, { repoRoot });
      const manifestBytes = await fs.readFile(manifestPath), manifestHash = hashBytes(manifestBytes);
      const registeredManifestHash = await checksumFile(manifestPath);
      if (!pieces.pieces.some(piece => piece.name === 'semantic_manifest'
        && piece.checksum === registeredManifestHash.algo + ':' + registeredManifestHash.value)) throw fail('Published semantic manifest checksum is not registered.');
      const tasks = new Map(), producedScopes = new Set();
      for (const partition of manifest.partitions) for await (const coverage of store.iterateRows(partition.partitionId, 'semantic_coverage', { signal })) {
        if (['complete', 'partial'].includes(coverage.state)) producedScopes.add(partition.sourceUnitId + ':' + coverage.phase);
      }
      for (const partition of manifest.partitions) for await (const task of store.iterateRows(partition.partitionId, 'semantic_frontier', { signal })) {
        assertSemanticTask(task);
        if (task.baseBuildId !== buildId) continue;
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
      const verifyCurrentPublication = async () => {
        throwIfAborted(signal);
        const current = JSON.parse(await fs.readFile(path.join(getBuildsRoot(repoRoot, userConfig), 'current.json'), 'utf8'));
        const relative = current.buildRootsByMode?.[mode] || (current.buildId === buildId ? current.buildRoot : null);
        if (current.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION || !relative) return false;
        const cacheRoot = toRealPathSync(runtime.repoCacheRoot);
        const publishedRoot = toRealPathSync(path.resolve(runtime.repoCacheRoot, relative));
        if (!isWithinRoot(publishedRoot, cacheRoot) || publishedRoot !== toRealPathSync(buildRoot)) return false;
        return hashBytes(await fs.readFile(manifestPath)) === manifestHash;
      };
      // Pending descriptors need the same publication authority as completed
      // receipts. An unpublished staging family must not reconstruct live work.
      if (!await verifyCurrentPublication()) throw fail('Control reconstruction requires the exact current publication.', 'ERR_SEMANTIC_PUBLICATION_REQUIRED');
      control ||= await openControl(runtime, diskAccount, signal);
      if (!control.available) return { status: 'unavailable', recovered, pending: tasks.size };
      const durableInputHashes = new Set(manifest.partitions.map(row => row.canonicalHash));
      for (const task of tasks.values()) {
        throwIfAborted(signal);
        control.enqueue({ task, durableInputHashes });
      }
      for (const receipt of manifest.completedTasks || []) {
        const task = tasks.get(receipt.taskId);
        if (!task || receipt.baseBuildId !== buildId || receipt.policyHash !== task.policyHash
          || receipt.inputHash !== semanticTaskInputHash(task)) throw fail('Completed compiler receipt differs from the durable task.');
        if (task.sourceUnits.some(source => task.coverageToProduce.some(phase => !producedScopes.has(source + ':' + phase)))) throw fail('Published compiler receipt has no actual phase output for every source.');
        const publication = { ...receipt, manifestHash, publishedBuildId: buildId };
        await control.reconcilePublished({ taskId: task.taskId, publication, verifyPublication: verifyCurrentPublication });
        recovered += 1;
      }
      pending += [...tasks.keys()].filter(id => control.getTask(id)?.state !== 'completed').length;
    }
    return { status: 'complete', recovered, pending };
  } finally { if (!controlStore) control?.close?.(); }
};

/** Persist deeper-analysis frontiers even when the base build elects not to run them. */
export const persistSemanticAnalysisFrontiers = async ({ state, runtime, signal = null }) => {
  const base = runtime.semanticPolicy;
  if (state.semanticPhaseWorkPrepared) return (state.semanticPhaseTasks || []).filter(task => task.kind !== 'bind');
  if (!base?.enabled || !state.semanticFactsByFile?.size) return [];
  const entries = [...state.semanticFactsByFile].sort(([, a], [, b]) => a.sourceUnitId.localeCompare(b.sourceUnitId));
  const generation = entries[0][1].storage.generation, root = path.join(runtime.buildRoot, entries[0][1].storage.relativePath);
  const groups = new Map();
  for (const [file, descriptor] of entries) {
    throwIfAborted(signal);
    if (canonicalSemanticJson(descriptor.storage.generation) !== canonicalSemanticJson(generation) || path.resolve(runtime.buildRoot, descriptor.storage.relativePath) !== path.resolve(root)) throw fail('Mixed deferred analysis generations or roots.');
    const syntax = descriptor.partitions.find(partition => partition.partitionId === descriptor.syntaxPartitionId);
    const store = createArtifactSemanticStore({ root, repoRoot: runtime.root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation, partitions: [syntax] });
    for await (const source of store.iterateRows(syntax.partitionId, 'semantic_sources', { signal })) {
      if (!['javascript', 'typescript'].includes(source.language) || source.mapping && source.mapping.quality !== 'exact') continue;
      const sourcePath = source.mapping ? entries.find(([, parent]) => parent.sourceUnitId === source.mapping.parentSourceUnitId)?.[0] || source.path : source.path;
      const policy = resolveSemanticSourcePolicy(base, { sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, language: source.language, path: sourcePath });
      const plan = state.semanticPlanningBySource?.get(source.sourceUnitId) || planSemanticSource(policy, { sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, syntaxPartitionId: syntax.partitionId });
      for (const phase of ['localFlow', 'crossFileFlow']) {
        if (plan.modes[phase] !== 'deferred' || !policy.languages.includes(source.language)) continue;
        const completed = descriptor.coverage.some(row => row.phase === phase && ['complete', 'partial'].includes(row.state));
        if (completed) continue;
        const key = semanticHash('semantic.deferred-analysis-group.v1', { phase, analysis: policy.identity.analysis });
        if (!groups.has(key)) groups.set(key, { phase, policy, entries: [] });
        groups.get(key).entries.push({ file, descriptor, syntax, source });
      }
    }
  }
  const tasks = [];
  for (const { phase, policy, entries: eligible } of groups.values()) {
    const targetSet = { schemaVersion: 1, generation, sourceUnits: ordered(eligible.map(entry => entry.source.sourceUnitId)), syntaxPartitionRefs: eligible.map(({ syntax }) => ({ partitionId: syntax.partitionId, canonicalHash: syntax.canonicalHash, sourceUnitId: syntax.sourceUnitId })).sort((a, b) => a.partitionId.localeCompare(b.partitionId)) };
    const targetSetHash = semanticHash('pairofcleats.semantic.binding-targets.v1', targetSet);
    const inventory = await writeTargetSet({ root, targetSet, targetSetHash, diskAccount: state.semanticDiskAccount, signal });
    state.semanticFrontierTargets ||= [];
    if (!state.semanticFrontierTargets.some(value => value.path === inventory.path)) state.semanticFrontierTargets.push(inventory);
    const inputHashes = ordered([...new Set(eligible.flatMap(({ descriptor }) => descriptor.partitions.filter(partition => !partition.members.semantic_frontier.some(piece => piece.count > 0)).map(partition => partition.canonicalHash)))]);
    const policyHash = semanticHash('semantic.deferred-analysis-policy.v1', { phase, analysis: policy.identity.analysis });
    const task = assertSemanticTask({ schemaVersion: 1, taskId: createSemanticTaskId({ kind: phase, inputHashes, policyHash, targetSetHash }), kind: phase, baseBuildId: generation.baseBuildId, sourceUnits: targetSet.sourceUnits, inputHashes, policyHash, targetSetHash, targetsRef: inventory.path, dependencies: [], priority: 1, reason: 'analysis_policy_deferred', coverageToProduce: [phase] });
    for (let index = 0; index < eligible.length; index += 1) {
      const { file, source } = eligible[index], current = state.semanticFactsByFile.get(file);
      const partitionId = createAnalysisPartitionId({ pass: { name: 'semantic-analysis-frontier', version: '1' }, inputPartitionHashes: inputHashes, compilerContext: { sourceUnitId: source.sourceUnitId }, dependencySummaryHashes: [], analysisPolicy: { taskId: task.taskId } });
      const coverage = { scope: { sourceUnitId: source.sourceUnitId }, phase, state: 'deferred', reason: 'analysis_policy_deferred', observedCount: null, completedCount: 0, frontierRef: task.taskId };
      const partition = await writeSemanticAnalysis({ policy, stagingRoot: root, source, sourceBytes: await fs.readFile(path.join(root, 'semantic-sources', source.byteHash + '.utf8')), partitionId, producerHash: semanticHash('semantic.analysis-frontier-producer.v1', { version: 1 }), policyHash, diskAccount: state.semanticDiskAccount, signal, rows: [...(index === 0 ? [{ family: 'frontier', row: task }] : []), { family: 'coverage', row: coverage }] });
      state.semanticFactsByFile.set(file, createSemanticFactsRef({ source, syntaxPartitionId: current.syntaxPartitionId, storage: current.storage, partitions: [...current.partitions.filter(value => value.partitionId !== partitionId), partition], coverage: [...current.coverage.filter(value => value.phase !== phase), coverage] }));
    }
    const control = await openControl(runtime, state.semanticDiskAccount, signal);
    try { if (control.available) control.enqueue({ task, durableInputHashes: new Set(inputHashes) }); } finally { control.close?.(); }
    tasks.push(task);
  }
  return tasks;
};
