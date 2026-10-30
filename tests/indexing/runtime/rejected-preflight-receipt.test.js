import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir, resolveTestCachePath } from '../../helpers/test-cache.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

// UNVALIDATED: real runtime receipt/storage/teardown with guards against CPU/model work.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['missing-model', 'invalid-plan', 'selection-drift', 'core-before-parse', 'pending-admission'].includes(selected));
const { dir: fixtureRoot } = await prepareIsolatedTestCacheDir('rejected-preflight-' + selected);
const root = path.join(fixtureRoot, 'repo'), cache = path.join(fixtureRoot, 'cache'), home = path.join(fixtureRoot, 'home');
const models = path.join(fixtureRoot, 'models'), missing = path.join(models, 'missing.onnx');
await fs.mkdir(root); await fs.writeFile(path.join(root, 'source.js'), 'export function neverParsed() { return 42; }');
applyTestEnv({ cacheRoot: cache, embeddings: null, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null },
  testConfig: { quality: 'fast', threads: 1, models: { id: 'fixture/model', dir: models },
    indexing: { embeddings: { enabled: true, mode: 'inline', provider: 'onnx', onnx: { modelPath: missing } },
      scm: { provider: 'git' }, platformPresets: { startupCalibration: true }, daemon: { enabled: true } } } });
const counterKey = '__pocRejectedPreflightCounters'; assert.equal(Object.hasOwn(globalThis, counterKey), false);
globalThis[counterKey] = { calls: {}, loads: new Set(), parses: 0 };
const guards = [
  ['../../../src/index/build/runtime/workers.js', 'createRuntimeWorkerPools', true],
  ['../../../src/index/build/runtime/dictionaries.js', 'resolveRuntimeDictionaries', true],
  ['../../../src/index/build/runtime/embeddings.js', 'resolveEmbeddingRuntime', true],
  ['../../../src/index/build/runtime/tree-sitter-preload.js', 'preloadTreeSitterWithDaemonCache', true],
  ['../../../src/index/build/runtime/platform-preset.js', 'runStartupCalibrationProbe', true],
  ['../../../src/index/build/runtime/daemon-session.js', 'acquireRuntimeDaemonSession', false]
].map(([file, name, async]) => ({ url: new URL(file, import.meta.url).href, name, async }));
const hook = registerHooks({ load(url, context, next) {
  const result = next(url, context), guard = guards.find(entry => entry.url === url);
  if (guard) {
    const source = String(result.source), needle = 'export const ' + guard.name + ' = ' + (guard.async ? 'async ' : '') + '(';
    assert.equal(source.split(needle).length, 2, 'instrument the actual operation boundary: ' + guard.name);
    globalThis[counterKey].loads.add(guard.name);
    const replacement = 'export const ' + guard.name + ' = (...args) => { const c = globalThis.' + counterKey
      + '; c.calls.' + guard.name + ' = (c.calls.' + guard.name + ' || 0) + 1; throw new Error("Rejected preflight entered ' + guard.name
      + '"); }; const unused_' + guard.name + ' = ' + (guard.async ? 'async ' : '') + '(';
    return { ...result, source: source.replace(needle, replacement) };
  }
  if (url === new URL('../../../src/lang/babel-parser.js', import.meta.url).href) {
    const source = String(result.source), needle = "import { parse } from '@babel/parser';";
    assert.equal(source.split(needle).length, 2);
    return { ...result, source: source.replace(needle, "import { parse as originalParse } from '@babel/parser';\nconst parse = (...args) => { globalThis."
      + counterKey + '.parses++; return originalParse(...args); };') };
  }
  return result;
} });
const stat = fsSync.statSync, stdoutWrite = process.stdout.write, stderrWrite = process.stderr.write;
let output = '', workError, observedFailure, settled = false;
for (const stream of [process.stdout, process.stderr]) {
  const original = stream === process.stdout ? stdoutWrite : stderrWrite;
  stream.write = function (chunk, ...args) {
    output = (output + String(chunk)).slice(-16384); return original.call(this, chunk, ...args);
  };
}
const containsCode = (error, code, seen = new Set()) => {
  if (!error || !['object', 'function'].includes(typeof error) || seen.has(error)) return false;
  seen.add(error);
  return error.code === code || containsCode(error.cause, code, seen)
    || (Array.isArray(error.errors) && error.errors.some(value => containsCode(value, code, seen)));
};
try {
  const { loadUserConfig, getEffectiveConfigHash, getBuildsRoot } = await import('../../../src/shared/dict-utils.js');
  const { resolveRepoCacheRootPath } = await import('../../../src/shared/repo-paths.js');
  const { createEmbeddingExecutionPlan, preflightEmbeddingExecutionPlan, readEmbeddingPreflightRejection,
    projectEmbeddingExecutionEvidence } = await import('../../../src/shared/embedding-execution-plan.js');
  const { createBuildRuntime } = await import('../../../src/index/build/runtime/runtime.js');
  const { readRuntimeReceipt } = await import('../../../src/shared/runtime-envelope/read-receipt.js');
  const { inspectStorageAccess } = await import('../../../src/shared/storage/access.js');
  const config = loadUserConfig(root), repoCache = resolveRepoCacheRootPath(root, config), builds = getBuildsRoot(root, config);
  const argv = { mode: 'code', stage: 'stage2', threads: 1, model: 'fixture/model', dims: 8 };
  let original, evidence;
  if (selected === 'core-before-parse' || selected === 'pending-admission') {
    if (selected === 'pending-admission') {
      original = Object.freeze(Object.assign(new Error('original model inspection still owns work'), {
        code: 'ERR_FIXTURE_MODEL_PENDING', cacheOwnershipPending: true,
        cacheOwnershipReleased() { assert.equal(this, original); return settled; }
      }));
      fsSync.statSync = (file, ...args) => { if (path.resolve(String(file)) === missing) throw original; return stat(file, ...args); };
    }
    const { buildIndex } = await import('../../../src/integrations/core/build-index/index.js');
    observedFailure = await buildIndex(root, { mode: 'code', threads: 1, model: 'fixture/model', dims: 8, sqlite: false })
      .then(() => assert.fail('required embedding preflight must fail'), error => error);
  } else {
    try {
      const plan = createEmbeddingExecutionPlan({ root, modes: ['code'], argv: selected === 'invalid-plan' ? { ...argv, dims: NaN } : argv,
        userConfig: config, intent: { embeddingEnabled: true, useStubEmbeddings: false, resolvedEmbeddingMode: 'inline' } });
      preflightEmbeddingExecutionPlan(plan);
      assert.fail('fixture requires a real selected-plan/model failure');
    } catch (error) { original = error; }
    evidence = readEmbeddingPreflightRejection(original);
    if (selected !== 'invalid-plan') {
      assert.ok(evidence); assert.equal(projectEmbeddingExecutionEvidence(evidence).preflight.status, 'unavailable');
    } else assert.equal(evidence, null, 'invalid requests cannot manufacture a complete selected plan');
    observedFailure = await createBuildRuntime({ root, argv, rawArgv: [], embeddingSelection: evidence,
      initializationRejection: { phase: 'embedding-preflight', error: original,
        effectiveConfigHash: selected === 'selection-drift' ? 'stale-selection' : getEffectiveConfigHash(root, config),
        expectedRepoCacheRoot: repoCache } }).then(() => assert.fail('rejected runtime cannot initialize normally'), error => error);
  }
  const code = selected === 'pending-admission' ? 'ERR_FIXTURE_MODEL_PENDING'
    : selected === 'invalid-plan' ? 'ERR_EMBEDDING_EXECUTION_PLAN' : 'ERR_EMBEDDING_MODEL_PATH';
  assert.equal(containsCode(observedFailure, code), true, 'the original admission failure survives diagnostic ownership');
  assert.deepEqual(globalThis[counterKey].calls, {}); assert.equal(globalThis[counterKey].parses, 0);
  assert.equal(globalThis[counterKey].loads.size, guards.length, 'every guarded production owner was actually instrumented');
  let entries;
  try { entries = await fs.readdir(builds, { withFileTypes: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
  if (selected === 'pending-admission' || selected === 'selection-drift') {
    assert.equal(entries.length, 0, 'unknown original work/config drift cannot choose a new durable receipt namespace');
    if (selected === 'pending-admission') {
      assert.equal(observedFailure.cacheOwnershipReleased(), false); settled = true;
      assert.equal(observedFailure.cacheOwnershipReleased(), true);
    } else {
      assert.equal(containsCode(observedFailure, 'ERR_RUNTIME_REJECTION_SELECTION_CHANGED'), true);
      assert.ok(output.includes('initialization failed before a durable receipt root'), 'the expected unavailable-receipt warning is asserted');
    }
  } else {
    assert.equal(entries.length, 1); assert.equal(entries[0].isDirectory(), true);
    const buildRoot = path.join(builds, entries[0].name), report = await readRuntimeReceipt({ buildRoot, requireProducerIdentity: true });
    assert.equal(report.evidence, 'persisted-runtime-receipt'); assert.equal(report.attempts.length, 1);
    const attempt = report.attempts[0];
    assert.equal(attempt.lifecycle, 'failed'); assert.equal(attempt.error.code, code);
    assert.equal(attempt.inputs.admission.phase, 'embedding-preflight');
    assert.equal(attempt.inputs.admission.sourceDiscoveryEntered, false);
    assert.equal(attempt.embeddings.observation.state, 'failed'); assert.equal(attempt.runtime.workers, null);
    if (evidence) assert.equal(attempt.embeddings.selection.planDigest, evidence.plan.digest);
    assert.equal(output.includes('initialization failed before a durable receipt root'), false);
    assert.equal((await fs.readdir(buildRoot)).some(name => name.startsWith('index-')), false);
  }
  assert.equal((await inspectStorageAccess(repoCache, { coordinationRoot: path.join(home, 'state', 'storage-access') })).protected, false);
} catch (error) { workError = error; }
finally {
  fsSync.statSync = stat; process.stdout.write = stdoutWrite; process.stderr.write = stderrWrite;
  hook.deregister(); delete globalThis[counterKey]; settled = true;
  try {
    if (observedFailure) observeStorageResource(observedFailure, { phase: 'rejected-preflight-fixture-settlement' }).requireSettled();
    if (workError) observeStorageResource(workError, { phase: 'rejected-preflight-fixture-cleanup' }).requireSettled();
    const absolute = path.resolve(fixtureRoot), parent = path.resolve(resolveTestCachePath());
    assert.equal(path.dirname(absolute), parent); assert.ok(path.basename(absolute).startsWith('rejected-preflight-'));
    await fs.rm(absolute, { recursive: true, force: true });
  } catch (cleanupError) { workError = workError ? addStorageFailureContext(workError, {}, cleanupError) : cleanupError; }
}
if (workError) throw workError;
console.log('rejected embedding preflight receipt ' + selected + ' passed');
