import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compileSourceRevisionScenario, realizeSourceFile, sourceBytesHash, sourceStateId, sourceScenarioError, sealSourceRevisionEdits } from './source-scenario.js';
import { minimizeRevisionSequenceAsync } from './minimize.js';
import { referencePublishedSourceRevision, captureSourceRevisionOutput } from './source-reference.js';
import { revisionKey, revisionScenarioId } from './scenario.js';
import { finiteViewFields } from '../../../src/index/semantic/views/finite-input.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../../src/index/semantic/analysis-versions.js';
import { snapshotPlainData } from '../../../src/shared/plain-data-snapshot.js';
import { assertNoSymlinkPath, readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { atomicWriteText } from '../../../src/shared/io/atomic-write.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { resolveCurrentBuildGeneration } from '../../../src/shared/indexing/build-pointer.js';
import { assertCurrentIndexFormat } from '../../../src/contracts/index-format.js';
import { loadChunkMetaRows } from '../../../src/shared/artifact-io/loaders/chunk-meta.js';
import { runWithStorageSession, isStorageSessionReleaseFailure } from '../../../src/shared/storage/session.js';
import { createStorageObservationLedger } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { STORAGE_CATEGORIES } from '../../../src/shared/storage/layout.js';
import { isCanonicalChunkUid } from '../../../src/shared/identity.js';
import { INDEX_REVISION_PROFILE, INDEX_REVISION_RECEIPT_SCHEMA } from '../../../src/contracts/schemas/revision-index.js';
import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';
import { parseProgressEventLine } from '../../../src/shared/cli/progress-events.js';

export { INDEX_REVISION_PROFILE };
const validateReceipt = compileSchema(createAjv({ strict: true, allErrors: true }), INDEX_REVISION_RECEIPT_SCHEMA);
const TOOL_ROOT = fileURLToPath(new URL('../../../', import.meta.url)), runs = new WeakMap();
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const get = handle => { const run = runs.get(handle); if (!run) throw new TypeError('Original published-index revision execution required.'); return run; };
const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;
const scalar = (value, field) => {
  if (typeof value !== 'string' || !value.length || value.length > 16384) throw sourceScenarioError('Invalid published chunk ' + field); return value;
};
const childEnvironment = (home, repo) => {
  const env = { ...process.env };
  // Fixed, constructed source is explicitly launch-authorized. Generated data
  // cannot choose commands, a config path, application storage or test hooks.
  for (const key of ['PAIROFCLEATS_TESTING', 'PAIROFCLEATS_TEST_CONFIG', 'PAIROFCLEATS_TRUSTED_CONFIG',
    'PAIROFCLEATS_WORKER_POOL', 'PAIROFCLEATS_CACHE_ROOT']) delete env[key];
  for (const category of Object.values(STORAGE_CATEGORIES)) if (category.env) delete env[category.env];
  return { ...env, PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo]) };
};
const configFor = cacheRoot => ({ cache: { root: cacheRoot },
  indexing: { scm: { provider: 'none' }, semantic: { enabled: false }, typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false,
    javascript: { parser: 'babel', flow: 'off' },
    embeddings: { enabled: false, mode: 'off', hnsw: { enabled: false }, lancedb: { enabled: false } } },
  tooling: { autoEnableOnDetect: false, autoInstallOnDetect: false, lsp: { enabled: false } } });
const requireRunResourcesSettled = run => {
  if (!run.observation.isSettled()) throw Object.assign(new Error('Original published-index resource work remains pending.'), {
    code: 'ERR_REVISION_INDEX_RESOURCES_PENDING'
  });
};
const checkRun = run => {
  requireRunResourcesSettled(run);
  throwIfAborted(run.signal);
  if (performance.now() >= run.deadline) throw sourceScenarioError('Published-index revision execution reached its work deadline.');
};
const retainRunFailure = (run, handle, error) => {
  run.observation.remember(error);
  let failure = addStorageFailureContext(error, {}, run.firstFailure, { secondaryPresent: run.failurePresent,
    forceAggregate: true, ownerMessage: 'Published-index revision work or retirement failed; original evidence remains retained.' });
  if (!run.failurePresent) { run.firstFailure = error; run.failurePresent = true; }
  for (const inspection of run.observation.snapshot().inspectionErrors) failure = addStorageFailureContext(failure, {}, inspection,
    { secondaryPresent: true, forceAggregate: true, ownerMessage: 'Original published-index resource inspection remains retained.' });
  failure = addStorageFailureContext(failure, { cacheOwnershipPending: true,
    cacheOwnershipReleased: () => !runs.has(handle) && run.observation.isSettled(),
    sourceIndexRevisionSession: Object.freeze({ handle, root: run.root, releaseAfterClosure: () => retireIndexRevisionRun(handle) }) }, null,
  { forceAggregate: true, nonEnumerable: ['sourceIndexRevisionSession'], ownerMessage: 'Published-index revision work or retirement failed; original evidence remains retained.' });
  // Only this run's exact outward ownership aggregate is excluded from its
  // internal prerequisites. Its independent context inspections stay binding.
  run.ownFailures.add(failure); run.observation.remember(failure); return failure;
};
const writeState = async (run, repo, files, previous = []) => {
  const names = new Set(files.map(file => file.path));
  for (const name of previous) if (!names.has(name)) {
    checkRun(run); const filename = path.join(repo, name); assertNoSymlinkPath(repo, filename); await fs.unlink(filename); checkRun(run);
  }
  for (const file of files) {
    checkRun(run); const filename = path.join(repo, file.path); assertNoSymlinkPath(repo, filename, { allowMissing: true });
    await atomicWriteText(filename, realizeSourceFile(file), { signal: run.signal, beforeCommit: () => checkRun(run) }); checkRun(run);
  }
};
const readSources = async (run, repo, files) => {
  const sources = new Map();
  for (const file of files) {
    checkRun(run); const expected = Buffer.from(realizeSourceFile(file));
    const { buffer, hash } = await readVerifiedContainedFile(repo, path.join(repo, file.path), { maxBytes: 65536, signal: run.signal }); checkRun(run);
    if (!buffer.equals(expected)) throw sourceScenarioError('Constructed source changed during index execution.');
    sources.set(file.path, { text: buffer.toString('utf8'), byteHash: hash, byteLength: buffer.length });
  }
  return sources;
};
const inspectPublished = async (run, repo, config, files, expectedPointerHash = null) => {
  checkRun(run);
  const repoCacheRoot = resolveRepoCacheRootPath(repo, config), buildsRoot = path.join(repoCacheRoot, 'builds'), currentPath = path.join(buildsRoot, 'current.json');
  let capturedSession = null;
  try {
    const publication = await runWithStorageSession({ roots: [repoCacheRoot], authorizedRoots: [run.root],
      coordinationRoot: path.join(run.root, 'reader-state'), scope: INDEX_REVISION_PROFILE }, async session => {
      capturedSession = session; run.readers.set(session, null);
      const source = await readSources(run, repo, files), pointer = await readVerifiedContainedFile(buildsRoot, currentPath, { maxBytes: 65536, signal: run.signal });
      checkRun(run);
      if (expectedPointerHash && pointer.hash !== expectedPointerHash) throw sourceScenarioError('The retained published-index generation changed.');
      const data = JSON.parse(pointer.buffer.toString('utf8'));
      assertCurrentIndexFormat({ operation: 'read', component: 'revision-oracle-build-pointer', foundVersion: data.artifactSurfaceVersion, repoRoot: repo, indexPath: currentPath });
      const generation = resolveCurrentBuildGeneration(data, { repoCacheRoot, buildsRoot, preferredMode: 'code' });
      if (!generation.activeRoot || !generation.buildId || !isPathWithinRoot(generation.activeRoot, buildsRoot)) throw sourceScenarioError('A current published code generation is required.');
      const indexRoot = path.join(generation.activeRoot, 'index-code'); assertNoSymlinkPath(buildsRoot, indexRoot);
      const rows = [], byFile = new Map([...source.keys()].map(name => [name, []]));
      // Stream and bound rows before retaining them; the normal strict loader
      // owns all physical source/columnar/cold-file reads and closure.
      for await (const row of loadChunkMetaRows(indexRoot, { strict: true, includeCold: true, maxBytes: 4 * 1024 * 1024 })) {
        checkRun(run); if (rows.length === 128) throw sourceScenarioError('Published source cohort exceeds its chunk-row bound.');
        const filename = scalar(row.file, 'file'), original = source.get(filename);
        if (!original || !Number.isSafeInteger(row.start) || !Number.isSafeInteger(row.end) || row.start < 0 || row.end < row.start || row.end > original.text.length) {
          throw sourceScenarioError('Published source chunk has a stale file or invalid UTF-16 interval.');
        }
        if (!isCanonicalChunkUid(row.chunkUid)) throw sourceScenarioError('A canonical published chunk UID is required.');
        const chunk = { name: scalar(row.name, 'name'), kind: scalar(row.kind, 'kind'), start: row.start, end: row.end,
          startLine: row.startLine ?? null, endLine: row.endLine ?? null,
          text: original.text.slice(row.start, row.end) };
        byFile.get(filename).push(chunk);
        rows.push({ file: filename, ...chunk, chunkUid: scalar(row.chunkUid, 'chunkUid'),
          tokens: snapshotPlainData(row.tokens ?? null, { maxBytes: 262144, maxItems: 65536, maxDepth: 4 }) });
      }
      rows.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : a.start - b.start || (a.chunkUid < b.chunkUid ? -1 : a.chunkUid > b.chunkUid ? 1 : 0));
      const output = captureSourceRevisionOutput([...source].filter(([, value]) => value.byteLength > 0).map(([filename, value]) => ({ path: filename,
        byteHash: value.byteHash, byteLength: value.byteLength, textLength: value.text.length,
        chunks: byFile.get(filename).sort((a, b) => a.start - b.start || a.end - b.end) })));
      await readSources(run, repo, files); checkRun(run);
      const after = await readVerifiedContainedFile(buildsRoot, currentPath, { maxBytes: 65536, signal: run.signal }); checkRun(run);
      if (after.hash !== pointer.hash) throw sourceScenarioError('Published generation changed while the oracle was reading.');
      return { generation: { buildId: generation.buildId, generationKey: generation.generationKey, pointerHash: pointer.hash, pointerPath: currentPath,
        artifactSurfaceVersion: data.artifactSurfaceVersion, indexRoot }, output, rows };
    }, { settlement: ({ resourceId, resourceObservation }) => {
      if (capturedSession) run.readers.set(capturedSession, resourceObservation);
      // Cancellation stops source admission; actual closed readers still retire.
      requireRunResourcesSettled(run); resourceObservation.requireSettled(); return { resourceId, settled: true, pending: false };
    } });
    return publication.value;
  } catch (error) {
    const session = Object.getOwnPropertyDescriptor(error, 'storageSession')?.value;
    const secondary = Object.getOwnPropertyDescriptor(error, 'storageSettlementError')?.value;
    if (session && (isStorageSessionReleaseFailure(error, session) || isStorageSessionReleaseFailure(secondary, session))) {
      if (!run.readers.has(session)) run.readers.set(session, null);
    }
    throw error;
  }
};
const build = async (run, repo, cacheRoot, files, ordinal, incremental) => {
  checkRun(run); const config = configFor(cacheRoot), configText = JSON.stringify(config);
  await atomicWriteText(path.join(repo, '.pairofcleats.json'), configText, { signal: run.signal, beforeCommit: () => checkRun(run) });
  const args = [path.join(TOOL_ROOT, 'bin', 'pairofcleats.js'), 'index', 'build', '--repo', repo, '--mode', 'code', '--stage', 'stage2', '--threads', '1', '--no-sqlite', '--progress', 'jsonl'];
  if (incremental) args.push('--incremental');
  const logPrefix = path.join(run.root, 'logs', String(ordinal));
  await atomicWriteText(logPrefix + '.command.json', JSON.stringify({ command: process.execPath, args, cwd: repo,
    configHash: sourceBytesHash(Buffer.from(configText)) }), { signal: run.signal, beforeCommit: () => checkRun(run) });
  const began = performance.now(), remainingMs = Math.max(1, Math.ceil(run.deadline - began));
  const result = await spawnSubprocess(process.execPath, args, { cwd: repo, env: childEnvironment(path.join(run.root, 'home'), repo),
    signal: run.signal, timeoutMs: remainingMs, maxOutputBytes: 1024 * 1024, outputEncoding: 'utf8', stdio: 'pipe', rejectOnNonZeroExit: false });
  run.observation.remember(result); checkRun(run);
  if (typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || result.outputCapture?.stdout?.truncated || result.outputCapture?.stderr?.truncated
    || result.outputCapture?.stdout?.encodingLoss || result.outputCapture?.stderr?.encodingLoss) {
    throw sourceScenarioError('Complete bounded build stdout/stderr evidence is required.');
  }
  await atomicWriteText(logPrefix + '.stdout.log', result.stdout, { signal: run.signal });
  await atomicWriteText(logPrefix + '.stderr.log', result.stderr, { signal: run.signal }); checkRun(run);
  if (result.exitCode !== 0 || result.signal) throw Object.assign(new Error('The original index build failed; its status and logs are retained.', { cause: result }), {
    code: 'ERR_REVISION_INDEX_BUILD_FAILED', command: process.execPath, args, cwd: repo, logPrefix
  });
  for (const stream of ['stdout', 'stderr']) for (const line of result[stream].split('\n')) {
    if (!line.trim()) continue;
    const event = parseProgressEventLine(line);
    if (!event || ['warn', 'error'].includes(event.level) || ['failed', 'error', 'cancelled', 'aborted'].includes(event.status)) {
      throw Object.assign(new Error('Index qualification requires complete structured progress without warnings or errors.', { cause: result }), {
        code: 'ERR_REVISION_INDEX_DIAGNOSTICS', stream, line: line.slice(0, 1024), logPrefix
      });
    }
  }
  const published = await inspectPublished(run, repo, config, files);
  return { ...published, execution: { executionId: randomUUID(), command: process.execPath, args, cwd: repo,
    configHash: sourceBytesHash(Buffer.from(configText)), exitCode: result.exitCode, signal: result.signal ?? null, elapsedMs: performance.now() - began,
    stdoutHash: sourceBytesHash(Buffer.from(result.stdout)), stderrHash: sourceBytesHash(Buffer.from(result.stderr)),
    stdoutBytes: Buffer.byteLength(result.stdout), stderrBytes: Buffer.byteLength(result.stderr), logPrefix } };
};

/** Explicit offline real-stage2 cohort. Only the closed inert source grammar
 * is materialized; no source, shell, project hook or caller callback executes. */
export const runIndexRevisionScenario = async (input, options = {}) => {
  const compiled = compileSourceRevisionScenario(input);
  const { parent, checkpoints = compiled.states.map((_, index) => index), maxMs = 25000, signal = null } = finiteViewFields(options, ['parent'], ['checkpoints', 'maxMs', 'signal'], sourceScenarioError);
  const selected = snapshotPlainData(checkpoints, { maxBytes: 4096, maxNodes: 32, maxDepth: 1, maxItems: 17 });
  if (compiled.scenario.parser !== 'babel' || !path.isAbsolute(parent || '') || path.parse(parent).root === path.resolve(parent)
    || !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 25000 || !Array.isArray(selected) || !selected.length
    || selected[0] !== 0 || selected.some((index, position) => !Number.isSafeInteger(index) || index < 0 || index >= compiled.states.length || position > 0 && index <= selected[position - 1])) {
    throw sourceScenarioError('Published-index cohorts require Babel, an explicit non-root parent, ordered unique checkpoints starting at zero and at most25 seconds.');
  }
  const boundedSignal = signal === null ? AbortSignal.timeout(maxMs) : AbortSignal.any([signal, AbortSignal.timeout(maxMs)]);
  const deadline = performance.now() + maxMs;
  throwIfAborted(boundedSignal);
  assertNoSymlinkPath(path.parse(parent).root, parent);
  if (!(await fs.lstat(parent)).isDirectory()) throw sourceScenarioError('The task-owned parent must already exist.');
  const physicalParent = await fs.realpath(parent); throwIfAborted(boundedSignal);
  const root = await fs.mkdtemp(path.join(parent, 'rev-')), identity = await fs.lstat(root, { bigint: true }), nonce = randomUUID();
  const handle = Object.freeze({ executionId: randomUUID(), scenarioId: compiled.scenarioId }), ownFailures = new WeakSet();
  const run = { root, parent: physicalParent, identity, nonce, ownFailures, compiled, receipt: null, releasing: null, minimizing: false, readers: new Map(), failurePresent: false, firstFailure: null,
    snapshots: new Map(), activeReads: new Map(), rechecks: 0, requestSignal: signal,
    signal: boundedSignal, deadline,
    observation: createStorageObservationLedger({ isOwnFailure: error => ownFailures.has(error) }) };
  runs.set(handle, run);
  try {
    // Once the directory exists, finish its tiny ownership record even if
    // cancellation arrived during creation, so normal retirement can own it.
    await atomicWriteText(path.join(root, '.source-index-revision-owner'), nonce, { createOnly: true });
    checkRun(run);
    const candidateRepo = path.join(root, 'candidate'), candidateCache = path.join(root, 'candidate-cache'); await fs.mkdir(candidateRepo);
    const checked = []; let previous = [], ordinal = 0;
    for (const index of selected) {
      checkRun(run); const files = compiled.states[index], freshRepo = path.join(root, 'fresh-' + index), freshCache = path.join(root, 'fresh-cache-' + index);
      await writeState(run, candidateRepo, files, previous); previous = files.map(file => file.path);
      const candidate = await build(run, candidateRepo, candidateCache, files, ordinal++, true);
      await fs.mkdir(freshRepo); await writeState(run, freshRepo, files);
      const fresh = await build(run, freshRepo, freshCache, files, ordinal++, false);
      run.snapshots.set(index, { repo: freshRepo, config: configFor(freshCache), files, pointerHash: fresh.generation.pointerHash,
        outputId: revisionScenarioId(fresh.rows), generationKey: fresh.generation.generationKey });
      const reference = referencePublishedSourceRevision(files, { signal: run.signal }), expected = reference.output;
      const independent = expected ? revisionKey(expected) === revisionKey(candidate.output) ? 'pass' : 'fail' : 'unknown';
      const parity = revisionKey(candidate.rows) === revisionKey(fresh.rows);
      checked.push({ index, checkpointId: index ? compiled.scenario.revisions[index - 1].id : 'base', stateId: sourceStateId(files),
        outcome: !parity || independent === 'fail' ? 'fail' : independent,
        candidate: { ...candidate.generation, execution: candidate.execution, outputId: revisionScenarioId(candidate.rows) },
        rebuild: { ...fresh.generation, execution: fresh.execution, outputId: revisionScenarioId(fresh.rows) },
        claims: [{ tier: 'independent-source-construction-grammar', relation: 'published-chunk-utf16-ranges-and-source-text', outcome: independent },
          { tier: 'same-implementation-clean-rebuild', relation: 'exact-chunk-uids-ranges-text-and-published-tokens', outcome: parity ? 'pass' : 'fail' }],
        counterexample: !parity || independent === 'fail' ? { expected, actual: candidate.output, candidateRows: candidate.rows, rebuildRows: fresh.rows } : null });
    }
    run.receipt = freeze(snapshotPlainData({ schemaVersion: 1, kind: 'published-code-chunk-index-revision-run', profile: INDEX_REVISION_PROFILE,
      executionId: handle.executionId, scenarioId: handle.scenarioId, workspace: root, checkpoints: checked,
      requestedCheckpoints: selected, omittedCheckpoints: compiled.states.map((_, index) => index).filter(index => !selected.includes(index)),
      completeScenarioCoverage: selected.length === compiled.states.length, outcome: checked.some(row => row.outcome === 'fail') ? 'fail' : checked.every(row => row.outcome === 'pass') ? 'pass' : 'unknown',
      producer: { node: process.version, abi: process.versions.modules, sourceChunking: SEMANTIC_ANALYSIS_VERSIONS.sourceChunking,
        javascriptRelations: SEMANTIC_ANALYSIS_VERSIONS.javascriptRelations },
      scope: 'real-stage2-code-publication; constructed-javascript; no-embeddings-sqlite-enrichment-or-generated-source-execution',
      strategy: 'serial-incremental-candidate-and-isolated-clean-build; production-default-worker-backend',
      limits: { maxMs, sourceBytes: 65536, chunkRows: 128, receiptBytes: 262144, outputBytesPerStream: 1048576 } },
    { maxBytes: 262144, maxDepth: 32, maxItems: 65536 }));
    if (!validateReceipt(run.receipt)) throw sourceScenarioError('Invalid original published-index revision receipt.');
    return handle;
  } catch (error) { throw retainRunFailure(run, handle, error); }
};
export const readIndexRevisionRun = handle => { const run = get(handle); if (!run.receipt) throw new Error('No completed published-index revision receipt.'); return run.receipt; };
/** Re-read one retained original clean world through the same strict loader.
 * Joined callers receive the exact promise tracked by this run's owner. */
export const recheckIndexRevisionRun = (handle, index) => {
  const run = get(handle), snapshot = run.snapshots.get(index);
  if (!run.receipt || !Number.isSafeInteger(index) || !snapshot || run.releasing) throw sourceScenarioError('An original completed checkpoint and idle retirement owner are required.');
  if (run.activeReads.has(index)) return run.activeReads.get(index);
  if (run.rechecks === 16) throw sourceScenarioError('Retained index recheck allowance exhausted.');
  run.rechecks++;
  const operation = { ...run, deadline: performance.now() + 3000,
    signal: run.requestSignal ? AbortSignal.any([run.requestSignal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000) };
  const task = (async () => {
    const actual = await inspectPublished(operation, snapshot.repo, snapshot.config, snapshot.files, snapshot.pointerHash);
    if (revisionScenarioId(actual.rows) !== snapshot.outputId || actual.generation.generationKey !== snapshot.generationKey) {
      throw sourceScenarioError('Retained published chunk content or identities changed.');
    }
    return Object.freeze({ index, outputId: snapshot.outputId, generationKey: snapshot.generationKey, unchanged: true });
  })().catch(error => { throw retainRunFailure(run, handle, error); }).finally(() => { run.activeReads.delete(index); });
  run.activeReads.set(index, task); return task;
};
export const retireIndexRevisionRun = async handle => {
  const run = get(handle);
  if (run.minimizing) throw Object.assign(new Error('Original revision minimization remains active.'), { code: 'ERR_REVISION_INDEX_MINIMIZATION_PENDING',
    cacheOwnershipPending: true, cacheOwnershipReleased: () => !run.minimizing });
  if (!run.releasing) run.releasing = (async () => {
    if (run.activeReads.size) throw Object.assign(new Error('Original index rechecks remain active.'), {
      code: 'ERR_REVISION_INDEX_RECHECKS_PENDING', cacheOwnershipPending: true, cacheOwnershipReleased: () => run.activeReads.size === 0
    });
    for (const [session, prerequisite] of run.readers) {
      prerequisite?.requireSettled();
      if (await session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false }) !== true) {
        throw sourceScenarioError('Original index-reader metadata did not confirm retirement.');
      }
    }
    requireRunResourcesSettled(run); assertNoSymlinkPath(run.parent, run.root);
    const physical = await fs.realpath(run.root), identity = await fs.lstat(run.root, { bigint: true });
    if (path.dirname(physical) !== run.parent || !isPathWithinRoot(physical, run.parent) || !sameIdentity(identity, run.identity)) throw sourceScenarioError('Original revision fixture root changed; unknown data is preserved.');
    const marker = await readVerifiedContainedFile(run.root, path.join(run.root, '.source-index-revision-owner'), { maxBytes: 128 });
    if (marker.buffer.toString('utf8') !== run.nonce) throw sourceScenarioError('Original revision fixture marker changed; unknown data is preserved.');
    requireRunResourcesSettled(run); await fs.rm(physical, { recursive: true, force: false }); runs.delete(handle);
    return Object.freeze({ executionId: handle.executionId, retired: true });
  })().catch(error => { throw retainRunFailure(run, handle, error); }).finally(() => { run.releasing = null; });
  return run.releasing;
};

/** Only an actual independently failing retained checkpoint can start real
 * rebuild trials. Neither diagnostic outputs nor fresh-build disagreement alone
 * supply that authority. Every trial uses the original cohort's checkpoint IDs. */
export const minimizeIndexRevisionFailure = async (handle, options = {}) => {
  const run = get(handle), { checkpointId, maxAttempts = 32, maxMs = 25000, signal = null } = finiteViewFields(
    options, ['checkpointId'], ['maxAttempts', 'maxMs', 'signal'], sourceScenarioError);
  const began = performance.now();
  if (!Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 25000 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 64
    || signal !== null && !(signal instanceof AbortSignal) || run.releasing || run.minimizing || run.activeReads.size) throw sourceScenarioError('Bounded original idle revision run required.');
  const matches = receipt => receipt.checkpoints.some(row => row.checkpointId === checkpointId && row.counterexample?.expected
    && row.claims.some(claim => claim.tier === 'independent-source-construction-grammar' && claim.outcome === 'fail'));
  if (!run.receipt || !matches(run.receipt)) throw sourceScenarioError('Original execution has no matching independent published-index failure.');
  const checkpoint = run.receipt.checkpoints.find(row => row.checkpointId === checkpointId), cohort = new Set(run.receipt.checkpoints.map(row => row.checkpointId));
  const boundedSignal = signal === null ? AbortSignal.timeout(maxMs) : AbortSignal.any([signal, AbortSignal.timeout(maxMs)]);
  throwIfAborted(boundedSignal); run.minimizing = true;
  try {
    await recheckIndexRevisionRun(handle, checkpoint.index);
    throwIfAborted(boundedSignal);
    const remaining = Math.floor(maxMs - (performance.now() - began));
    if (remaining < 1) throw sourceScenarioError('Original revision minimization allowance exhausted before a trial.');
    const availableRechecks = 16 - run.rechecks;
    if (availableRechecks < 1) throw sourceScenarioError('Original world recheck allowance exhausted; establish a fresh failing cohort before minimization.');
    const result = await minimizeRevisionSequenceAsync({ originalScenario: run.compiled.scenario, originalReceipt: run.receipt,
      maximumMs: 25000, matches, seal: sealSourceRevisionEdits, invalidScenario: error => error.code === 'ERR_SOURCE_REVISION_SCENARIO',
      run: async (scenario, budget) => {
        await recheckIndexRevisionRun(handle, checkpoint.index);
        throwIfAborted(boundedSignal);
        const time = Math.min(budget.maxMs, Math.floor(maxMs - (performance.now() - began)));
        if (time < 1) throw sourceScenarioError('Original revision minimization allowance exhausted before a trial.');
        return runIndexRevisionScenario(scenario, { parent: run.parent, ...budget, maxMs: time,
          checkpoints: [0, ...scenario.revisions.flatMap((edit, index) => cohort.has(edit.id) ? [index + 1] : [])] });
      },
      read: readIndexRevisionRun, dispose: retireIndexRevisionRun,
      captureWitness: receipt => receipt.checkpoints.find(row => row.checkpointId === checkpointId),
      kind: 'published-index-revision-minimization', selection: { checkpointId },
      predicate: 'same-checkpoint-independent-published-chunk-disagreement' }, { checkpointId, maxAttempts: Math.min(maxAttempts, availableRechecks), maxMs: remaining, signal: boundedSignal });
    return freeze(snapshotPlainData({ ...result, elapsedMs: performance.now() - began,
      trialWorlds: 'retired-through-original-owners; receipt-paths-are-diagnostic' }, { maxBytes: 524288, maxDepth: 48, maxItems: 65536 }));
  } finally { run.minimizing = false; }
};
