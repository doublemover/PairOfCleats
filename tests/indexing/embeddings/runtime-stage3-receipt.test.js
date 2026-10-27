#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createStage3RuntimeReceipts } from '../../../tools/build/embeddings/runtime-receipt.js';
import { initBuildState, flushBuildState } from '../../../src/index/build/build-state.js';
import { persistRuntimeAttempt } from '../../../src/index/build/build-state/runtime.js';
import { createRuntimeAttempt } from '../../../src/shared/runtime-envelope/receipt.js';
import { readRuntimeReceipt } from '../../../src/shared/runtime-envelope/read-receipt.js';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../../src/shared/embedding-identity.js';
import { createObservabilityEnvelope, applyObservabilityContextEnv } from '../../../src/shared/observability.js';
import { validateBuildState } from '../../../src/contracts/validators/build-state.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createBoundedWriterQueue } from '../../../tools/build/embeddings/writer-queue.js';
import { withRuntimeBindingObserver } from '../../../src/shared/runtime-envelope/execution-binding.js';

const { dir } = await prepareIsolatedTestCacheDir('runtime-stage3-receipt');
const rootsToFlush = new Set();
const repo = path.join(dir, 'repo');
await fs.mkdir(repo);
const identity = buildEmbeddingIdentity({ modelId: 'mock-stage3', provider: 'xenova', mode: 'stub', stub: true, dims: 3 });
const identityKey = buildEmbeddingIdentityKey(identity);
const rawEnv = applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, 'cache'), embeddings: 'stub' });
const config = {
  root: repo, repoCacheRoot: path.join(dir, 'cache'), modelsDir: path.join(dir, 'models'),
  modelId: identity.modelId, embeddingProvider: identity.provider, useStubEmbeddings: true,
  argv: { threads: 1 }, rawArgv: [], userConfig: {}, rawEnv,
  configSources: { files: [{ source: 'repository', path: path.join(repo, '.pairofcleats.json') }] }
};
const scheduler = { stats: () => ({ tokens: { cpu: { total: 1, used: 0 } }, activity: { running: 0 }, telemetry: { schedulingTrace: ['not persisted'] } }) };
const vectors = [Float32Array.from([0.1, 0.2, 0.3])];
let providerReads = 0;
const embedder = {
  getActiveProvider: () => { providerReads += 1; return 'xenova'; },
  executionInfo: () => ({ device: null, effectiveNativeThreads: null, requestedSessionOptions: { intraOpNumThreads: 2 } })
};
const initialize = async (name, buildId = name) => {
  const root = path.join(dir, name);
  rootsToFlush.add(root);
  await initBuildState({ buildRoot: root, buildId, repoRoot: repo, modes: ['code', 'prose'], stage: 'stage2' });
  return root;
};
const stateAt = async (root) => {
  const state = JSON.parse(await fs.readFile(path.join(root, 'build_state.json'), 'utf8'));
  assert.equal(validateBuildState(state).ok, true, JSON.stringify(validateBuildState(state)));
  return state;
};
const attemptAt = async (root, reference) => {
  const attempt = (await stateAt(root)).runtime.attempts.find((entry) => entry.attemptId === reference);
  assert.ok(attempt, 'awaited controller transitions must already exist in the durable build state');
  assert.equal(attempt.persistence.status, 'durable');
  return attempt;
};
const create = (rootEntries, overrides = {}, log = () => {}) => createStage3RuntimeReceipts({
  config: { ...config, ...overrides }, roots: new Map(rootEntries), identity, identityKey, log
});
const finish = (controller, mode, extras = {}) => controller.ready(mode, {
  cacheHits: 0, totalChunks: 1, scheduler, writer: { outputCount: 1 }, cacheRoot: path.join(dir, 'embedding-cache'), ...extras
});

try {
  const root = await initialize('durable', 'generation-durable');
  const submittedSelectionDigest = 'a'.repeat(64);
  const parent = await createRuntimeAttempt({ buildId: 'generation-durable', stage: 'stage2',
    embeddings: { selection: { planDigest: submittedSelectionDigest } } });
  await persistRuntimeAttempt(root, parent, { lifecycle: 'succeeded' });
  const selectedAt = '2026-10-12T00:00:00.000Z';
  const context = createObservabilityEnvelope({
    surface: 'index', operation: 'stage3', correlation: { correlationId: 'stage3-controller-test' },
    context: { runtimeAttemptId: parent.attemptId, embeddingSelectionDigest: submittedSelectionDigest }
  });
  const beforeInvalidSubmission = await fs.readFile(path.join(root, 'build_state.json'), 'utf8');
  await assert.rejects(create([['code', root]], {
    rawEnv: applyObservabilityContextEnv(rawEnv, { ...context, context: { ...context.context, embeddingSelectionDigest: 'invalid' } })
  }), { code: 'ERR_EMBEDDING_EXECUTION_PLAN' });
  assert.equal(await fs.readFile(path.join(root, 'build_state.json'), 'utf8'), beforeInvalidSubmission,
    'invalid selection metadata must not create or overwrite an attempt');
  const logs = [];
  const bindings = [];
  const controller = await withRuntimeBindingObserver(value => bindings.push(value), () => create([['code', root]], {
    rawEnv: applyObservabilityContextEnv(rawEnv, context),
    executionPlan: { buildId: 'generation-durable', digest: 'selected-plan-digest', selectedAt, resourcePolicy: { threads: 1 } }
  }, (line) => logs.push(line)));
  const ref = controller.reference('code');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].attemptId, ref);
  assert.equal(bindings[0].buildRoot, root);
  assert.equal(bindings[0].stage, 'stage3');
  assert.equal(bindings[0].correlationId, context.correlation.correlationId);
  assert.notEqual(ref, parent.attemptId);
  assert.equal(controller.reference('missing-mode'), null);
  let attempt = await attemptAt(root, ref);
  assert.equal(attempt.lifecycle, 'initializing');
  assert.equal(attempt.finishedAt, null);
  assert.equal(attempt.stage, 'stage3');
  assert.equal(attempt.mode, 'code');
  assert.equal(attempt.parentAttemptId, parent.attemptId);
  assert.equal(attempt.correlationId, 'stage3-controller-test');
  assert.equal(attempt.inputs.resolvedPlanDigest, 'selected-plan-digest');
  assert.equal(attempt.inputs.submittedSelectionDigest, parent.embeddings.selection.planDigest);
  assert.equal(attempt.inputs.selectedAt, selectedAt);
  assert.equal(attempt.paths.build.selected, root);
  assert.equal(attempt.embeddings.observation.state, 'not-started');
  assert.equal(attempt.embeddings.observation.provider, null);
  assert.equal(attempt.embeddings.observation.dims, null);
  assert.equal(logs.length, 1);
  assert.ok(logs[0].includes(ref));
  assert.ok(logs[0].includes(path.join(root, 'build_state.json')));
  await controller.resolved(identity, identityKey, scheduler);
  attempt = await attemptAt(root, ref);
  assert.equal(attempt.lifecycle, 'running');
  assert.deepEqual(attempt.runtime.scheduler.tokens, scheduler.stats().tokens);
  assert.equal(attempt.runtime.scheduler.traceIncluded, false);
  assert.equal(attempt.runtime.scheduler.telemetry, undefined);
  assert.equal(attempt.embeddings.identityKey, identityKey);
  await controller.loading('code');
  assert.equal((await attemptAt(root, ref)).embeddings.observation.state, 'loading');
  await Promise.all(Array.from({ length: 8 }, () => controller.observed('code', embedder, vectors, 'stub-vector-returned')));
  attempt = await attemptAt(root, ref);
  assert.equal(attempt.embeddings.observation.state, 'ready');
  assert.equal(attempt.embeddings.observation.provider, 'xenova');
  assert.equal(attempt.embeddings.observation.dims, 3);
  assert.equal(attempt.embeddings.observation.device, null);
  assert.equal(attempt.embeddings.observation.effectiveNativeThreads, null);
  assert.deepEqual(attempt.embeddings.observation.requestedSessionOptions, { intraOpNumThreads: 2 });
  assert.equal(attempt.embeddings.observation.sessionOptions, null);
  await finish(controller, 'code');
  attempt = await attemptAt(root, ref);
  assert.equal(attempt.embeddings.inferenceBatches, 8);
  assert.equal(attempt.embeddings.cacheHits, 0);
  assert.equal(attempt.embeddings.totalChunks, 1);
  assert.equal(attempt.paths.embeddingCache.state, 'missing');
  await controller.complete('code');
  attempt = await attemptAt(root, ref);
  assert.equal(attempt.lifecycle, 'succeeded');
  assert.ok(attempt.finishedAt);
  assert.equal((await attemptAt(root, parent.attemptId)).lifecycle, 'succeeded', 'child execution must preserve parent evidence');
  await controller.fail(new Error('late unrelated failure'));
  assert.equal((await attemptAt(root, ref)).lifecycle, 'succeeded', 'an already completed mode is not retroactively failed');

  const cacheRoot = await initialize('cache-only');
  const cache = await create([['code', cacheRoot]]);
  await cache.resolved(identity, identityKey, scheduler);
  await finish(cache, 'code', { cacheHits: 4, totalChunks: 4 });
  await cache.complete('code');
  const cacheAttempt = await attemptAt(cacheRoot, cache.reference('code'));
  assert.equal(cacheAttempt.lifecycle, 'succeeded');
  assert.equal(cacheAttempt.embeddings.inferenceBatches, 0);
  assert.equal(cacheAttempt.embeddings.observation.state, 'cache-only');
  assert.equal(cacheAttempt.embeddings.observation.method, 'validated-cache-reuse');
  assert.equal(cacheAttempt.embeddings.observation.provider, null);
  assert.equal(cacheAttempt.embeddings.observation.dims, null);

  const emptyRoot = await initialize('empty');
  const empty = await create([['code', emptyRoot]]);
  await empty.resolved(identity, identityKey, scheduler);
  await assert.rejects(empty.observed('code', embedder, []), { code: 'ERR_EMBEDDING_DIMS_MISMATCH' });
  await finish(empty, 'code', { cacheHits: 0, totalChunks: 0, writer: { outputCount: 0 } });
  await empty.complete('code');
  const emptyAttempt = await attemptAt(emptyRoot, empty.reference('code'));
  assert.equal(emptyAttempt.embeddings.observation.state, 'not-started');
  assert.equal(emptyAttempt.embeddings.inferenceBatches, 0);
  assert.equal(emptyAttempt.embeddings.observation.observedAt, null);

  const probeRoot = await initialize('probe-cache');
  const probe = await create([['code', probeRoot]]);
  await probe.loading();
  await probe.observed(null, embedder, vectors, 'provider-probe');
  await probe.resolved(identity, identityKey, scheduler);
  await finish(probe, 'code', { cacheHits: 4, totalChunks: 4 });
  await probe.complete('code');
  const probed = await attemptAt(probeRoot, probe.reference('code'));
  assert.equal(probed.embeddings.inferenceBatches, 0);
  assert.equal(probed.embeddings.observation.method, 'provider-probe', 'cache reuse preserves the independently observed provider probe');
  assert.equal(probed.embeddings.observation.state, 'ready');

  const mismatchBatchRoot = await initialize('second-batch-dimensions');
  const mismatchBatch = await create([['code', mismatchBatchRoot]]);
  await mismatchBatch.resolved(identity, identityKey, scheduler);
  await mismatchBatch.observed('code', embedder, vectors);
  const dimensionError = await mismatchBatch.observed('code', embedder, [new Float32Array(4)]).then(
    () => assert.fail('later dimension changes must reject even after an earlier ready observation'),
    (error) => error
  );
  assert.equal(dimensionError.code, 'ERR_EMBEDDING_DIMS_MISMATCH');
  await mismatchBatch.fail(dimensionError, 'code');
  const dimensionFailure = await attemptAt(mismatchBatchRoot, mismatchBatch.reference('code'));
  assert.equal(dimensionFailure.lifecycle, 'failed');
  assert.equal(dimensionFailure.embeddings.resolvedIdentity.dims, 3);

  const fallbackRoot = await initialize('initial-provider-fallback');
  const selectedOnnx = buildEmbeddingIdentity({ ...identity, provider: 'onnx' });
  const initialFallback = await createStage3RuntimeReceipts({
    config: { ...config, embeddingProvider: 'onnx' }, roots: new Map([['code', fallbackRoot]]),
    identity: selectedOnnx, identityKey: buildEmbeddingIdentityKey(selectedOnnx), log: () => {}
  });
  await initialFallback.loading('code');
  await initialFallback.observed('code', embedder, vectors, 'provider-probe');
  await initialFallback.resolved(identity, identityKey, scheduler);
  const fallbackAttempt = await attemptAt(fallbackRoot, initialFallback.reference('code'));
  assert.equal(fallbackAttempt.embeddings.requested.provider, 'onnx');
  assert.equal(fallbackAttempt.embeddings.resolvedIdentity.provider, 'xenova');
  assert.equal(fallbackAttempt.embeddings.observation.provider, 'xenova');
  await initialFallback.complete('code');

  const changedRoot = await initialize('later-provider-change');
  const changed = await create([['code', changedRoot], ['prose', changedRoot]]);
  await changed.resolved(identity, identityKey, scheduler);
  const changedProvider = { ...embedder, getActiveProvider: () => 'onnx' };
  for (const [mode, method] of [['code', 'successful-inference'], ['prose', 'provider-probe']]) {
    await changed.observed(mode, embedder, vectors);
    const providerError = await changed.observed(mode, changedProvider, vectors, method).then(
      () => assert.fail('provider change after resolved identity must reject, including a mislabeled later probe'),
      (error) => error
    );
    assert.equal(providerError.code, 'ERR_EMBEDDING_PROVIDER_CHANGED');
    await changed.fail(providerError, mode);
    const failedProvider = await attemptAt(changedRoot, changed.reference(mode));
    assert.equal(failedProvider.lifecycle, 'failed');
    assert.equal(failedProvider.embeddings.observation.provider, 'onnx');
    assert.equal(failedProvider.embeddings.observation.requestedProvider, 'xenova');
  }

  const sharedRoot = await initialize('shared-modes');
  const shared = await create([['code', sharedRoot], ['prose', sharedRoot]]);
  assert.notEqual(shared.reference('code'), shared.reference('prose'));
  await shared.resolved(identity, identityKey, scheduler);
  await shared.loading('code');
  assert.equal((await attemptAt(sharedRoot, shared.reference('prose'))).embeddings.observation.state, 'not-started');
  await shared.complete('code');
  await shared.fail(Object.assign(new Error('mock provider failed'), { code: 'ERR_MOCK_PROVIDER' }));
  assert.equal((await attemptAt(sharedRoot, shared.reference('code'))).lifecycle, 'succeeded');
  const failed = await attemptAt(sharedRoot, shared.reference('prose'));
  assert.equal(failed.lifecycle, 'failed');
  assert.equal(failed.error.code, 'ERR_MOCK_PROVIDER');
  assert.equal(failed.embeddings.observation.state, 'failed');
  assert.ok(failed.finishedAt);

  const mixedCode = await initialize('mixed-code', 'generation-code');
  const mixedProse = await initialize('mixed-prose', 'generation-prose');
  const mixed = await create([['code', mixedCode], ['prose', mixedProse]]);
  await mixed.resolved(identity, identityKey, scheduler);
  await mixed.fail(Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'ABORT_ERR' }), 'code');
  const aborted = await attemptAt(mixedCode, mixed.reference('code'));
  assert.equal(aborted.lifecycle, 'aborted');
  assert.equal(aborted.buildId, 'generation-code');
  assert.equal(aborted.error.code, 'ABORT_ERR');
  assert.ok(aborted.finishedAt);
  const separate = await attemptAt(mixedProse, mixed.reference('prose'));
  assert.equal(separate.lifecycle, 'running');
  assert.equal(separate.buildId, 'generation-prose');
  assert.equal(separate.paths.build.selected, mixedProse);
  assert.equal((await stateAt(mixedCode)).runtime.attempts.length, 1);
  assert.equal((await stateAt(mixedProse)).runtime.attempts.length, 1);
  await mixed.complete('prose');

  const writerRoot = await initialize('failed-writer-snapshot');
  const writerController = await create([['code', writerRoot]]);
  await writerController.resolved(identity, identityKey, scheduler);
  const writer = createBoundedWriterQueue({ maxPending: 1, maxPendingBytes: 1024 });
  await writer.enqueuePrepared({ estimateBytes: 512, prepare: () => Buffer.alloc(128),
    write() { throw Object.assign(new Error('controlled cache disk full'), { code: 'ENOSPC' }); } });
  await writer.onIdle();
  const snapshot = writer.stats();
  await writerController.fail(Object.assign(new Error('cancelled after cache write'), { name: 'AbortError', code: 'ABORT_ERR' }), 'code', { writer: snapshot });
  const failedWriter = await attemptAt(writerRoot, writerController.reference('code'));
  assert.equal(failedWriter.lifecycle, 'aborted');
  assert.deepEqual(failedWriter.runtime.writer, snapshot, 'durable failure records the actual drained queue snapshot');
  assert.equal(failedWriter.runtime.writer.failed, 1);
  assert.equal(failedWriter.runtime.writer.scheduled, 1);
  for (const key of ['pending', 'pendingBytes', 'producers', 'waitingProducerBytes', 'preparing']) assert.equal(snapshot[key], 0);

  const legacyRoot = await initialize('legacy', 'legacy-generation');
  assert.equal((await readRuntimeReceipt({ buildRoot: legacyRoot })).evidence, 'legacy-artifact-inference');
  const legacy = await create([['code', legacyRoot]]);
  const legacyAttempt = await attemptAt(legacyRoot, legacy.reference('code'));
  assert.equal(legacyAttempt.buildId, 'legacy-generation');
  assert.equal(legacyAttempt.embeddings.observation.state, 'not-started');
  assert.equal(legacyAttempt.parentAttemptId, null);
  assert.equal((await stateAt(legacyRoot)).runtime.attempts.length, 1, 'legacy metadata must not be converted into fabricated historical attempts');
  await legacy.complete('code');

  const missingRoot = path.join(dir, 'new-standalone');
  rootsToFlush.add(missingRoot);
  await fs.mkdir(missingRoot);
  const standalone = await create([['code', missingRoot]]);
  assert.equal((await attemptAt(missingRoot, standalone.reference('code'))).buildId, 'unknown');
  await standalone.complete('code');

  const mismatchRoot = await initialize('mismatch', 'actual-generation');
  const mismatchPath = path.join(mismatchRoot, 'build_state.json');
  const before = await fs.readFile(mismatchPath, 'utf8');
  const readsBefore = providerReads;
  await assert.rejects((async () => {
    const rejected = await create([['code', mismatchRoot]], { executionPlan: { buildId: 'different-generation' } });
    await rejected.loading('code');
    await rejected.observed('code', embedder, vectors);
  })(), { code: 'ERR_EMBEDDING_PLAN_GENERATION' });
  assert.equal(providerReads, readsBefore, 'generation mismatch fails before provider observation or activity');
  assert.equal(await fs.readFile(mismatchPath, 'utf8'), before, 'generation mismatch must not mutate existing evidence');

  const matchingRoot = await initialize('matching-first-root', 'different-generation');
  const matchingPath = path.join(matchingRoot, 'build_state.json');
  const matchingBefore = await fs.readFile(matchingPath, 'utf8');
  await assert.rejects(create([['code', matchingRoot], ['prose', mismatchRoot]], {
    executionPlan: { buildId: 'different-generation' }
  }), { code: 'ERR_EMBEDDING_PLAN_GENERATION' });
  assert.equal(await fs.readFile(matchingPath, 'utf8'), matchingBefore, 'a later root mismatch must not leave an orphaned attempt in an earlier valid root');

  const persistenceRoot = await initialize('write-failure');
  const persistence = await create([['code', persistenceRoot]]);
  await persistence.resolved(identity, identityKey, scheduler);
  const statePath = path.join(persistenceRoot, 'build_state.json');
  const rename = fs.rename;
  fs.rename = async (from, to) => {
    if (to === statePath && String(from).startsWith(`${statePath}.tmp-`)) throw Object.assign(new Error('mock receipt disk full'), { code: 'ENOSPC' });
    return rename(from, to);
  };
  try {
    await assert.rejects(persistence.complete('code'), { code: 'ERR_RUNTIME_RECEIPT_PERSIST' });
  } finally { fs.rename = rename; }
  assert.equal((await attemptAt(persistenceRoot, persistence.reference('code'))).lifecycle, 'running', 'failed durability cannot publish successful state');
  await persistence.fail(Object.assign(new Error('receipt write failed'), { code: 'ENOSPC' }), 'code');
  assert.equal((await attemptAt(persistenceRoot, persistence.reference('code'))).lifecycle, 'failed');

  const firstInitRoot = await initialize('partial-initialization-first');
  const secondInitRoot = await initialize('partial-initialization-second');
  const secondInitPath = path.join(secondInitRoot, 'build_state.json');
  fs.rename = async (from, to) => {
    if (to === secondInitPath && String(from).startsWith(`${secondInitPath}.tmp-`)) throw Object.assign(new Error('mock second root disk full'), { code: 'ENOSPC' });
    return rename(from, to);
  };
  try {
    await assert.rejects(create([['code', firstInitRoot], ['prose', secondInitRoot]]), { code: 'ERR_RUNTIME_RECEIPT_PERSIST' });
  } finally { fs.rename = rename; }
  const partialAttempt = (await stateAt(firstInitRoot)).runtime.attempts[0];
  assert.equal(partialAttempt.lifecycle, 'failed', 'a later initialization write failure terminates earlier initialized receipts');
  assert.equal(partialAttempt.error.code, 'ERR_RUNTIME_RECEIPT_PERSIST');
  assert.ok(partialAttempt.finishedAt);
  assert.equal((await stateAt(secondInitRoot)).runtime?.attempts?.length || 0, 0);

  for (const [label, payload, code] of [
    ['corrupt-json', '{', 'ERR_RUNTIME_RECEIPT_PERSIST'],
    ['unsupported-contract', JSON.stringify({ buildId: 'old-format', runtime: { schemaVersion: 999, attempts: [] } }), 'ERR_RUNTIME_RECEIPT_CONTRACT']
  ]) {
    const invalidRoot = path.join(dir, label);
    await fs.mkdir(invalidRoot);
    const invalidPath = path.join(invalidRoot, 'build_state.json');
    await fs.writeFile(invalidPath, payload);
    await assert.rejects(create([['code', invalidRoot]]), { code });
    assert.equal(await fs.readFile(invalidPath, 'utf8'), payload, 'unreadable or unsupported prior evidence must not be overwritten');
  }
} finally {
  for (const root of rootsToFlush) await flushBuildState(root);
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('stage3 runtime receipt lifecycle, correlation, mode isolation and durability passed (controller only)');
