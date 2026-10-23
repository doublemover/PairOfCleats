import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import { runOnnxProfileExperiment } from '../../../tools/bench/embeddings/onnx-profile-experiment.js';
import { acquireOnnxQualificationSlot } from '../../../src/shared/onnx-embeddings/qualification.js';
import { normalizeEmbeddingVectorInPlace } from '../../../src/shared/embedding-utils.js';
import { readEffectiveMemory } from '../../../src/shared/effective-memory.js';
import { resolveOnnxEmbeddingProcessing } from '../../../src/shared/embedding-dense-contract.js';
import { observeEmbeddingOwnership } from '../../../src/shared/embedding-cache-lifetime.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const { dir } = await prepareIsolatedTestCacheDir('onnx-profile-experiment-lifecycle', { clean: true });
const modelId = 'fixture/qualification', modelDir = path.join(dir, 'models', 'fixture', 'qualification');
await fs.mkdir(modelDir, { recursive: true });
const modelPath = path.join(modelDir, 'model.onnx');
await fs.writeFile(modelPath, 'inert model identity bytes'); await fs.writeFile(path.join(modelDir, 'tokenizer.json'), '{"inert":true}');
const candidate = { sessions: 1, intraOpNumThreads: 2, interOpNumThreads: 1,
  graphOptimizationLevel: 'extended', enableCpuMemArena: true, enableMemPattern: true };
const options = { rootDir: dir, modelId, modelsDir: path.join(dir, 'models'), onnxConfig: { modelPath, tokenizerId: modelId },
  envelope: { concurrency: { cpuConcurrency: { value: 4 } } }, memory: readEffectiveMemory(), candidate,
  texts: ['', 'alpha', 'beta beta', 'λ gamma'], batchSize: 2, rounds: 2 };
let loaded = 0, disposed = 0, active = 0, peakActive = 0, failAt = Infinity, calls = 0, controller = null;
const failure = new Error('controlled profile inference failure');
const createSession = input => {
  loaded++;
  const slot = acquireOnnxQualificationSlot(input.qualificationLease, { modelArtifact: input.modelArtifact, modelPath, lowMemory: false,
    processing: resolveOnnxEmbeddingProcessing(input.modelId) });
  let closed = false;
  return { embedderPromise: Promise.resolve(),
    getEmbeddings: async texts => {
      active++; peakActive = Math.max(peakActive, active);
      try {
        await yieldEventLoop();
        if (++calls >= failAt) throw failure;
        controller?.abort();
        return texts.map(text => normalizeEmbeddingVectorInPlace(Float32Array.of(1 + text.length, 2 + (text.codePointAt(0) || 0), 3)));
      } finally { active--; }
    }, executionInfo: () => ({ provider: 'onnx', effectiveNativeThreads: null, requestedSessionOptions: slot.options,
      measurements: { scope: 'inert-fixture', peakActive: 1, queueWaitMs: 0 } }),
    dispose: async () => { if (!closed) { closed = true; disposed++; slot.release(); } }
  };
};
const report = await runOnnxProfileExperiment({ ...options, createSession });
assert.equal(report.evidenceScope, 'inert-session-fixture');
assert.equal(report.status, 'observed-unaccepted'); assert.equal(report.accepted, false);
assert.equal(report.activation, 'none'); assert.equal(report.memoryEvidence, null, 'inert timings/RSS cannot mint native pool evidence');
assert.equal(report.parity.maxAbsoluteError, 0); assert.equal(report.parity.topKChanged, 0);
assert.equal(report.measured.stages.disposalConfirmed, true); assert.equal(loaded, 2); assert.equal(disposed, 2);
assert.equal(peakActive, 1, 'one session preserves serialized inference scratch ownership');
assert.equal(report.binding.workload.batchSize, 2);
assert.deepEqual(report.binding.processing, resolveOnnxEmbeddingProcessing(modelId));
for (const key of ['denseContract', 'outputAdmission', 'tokenization', 'tensorLifetime', 'tensorResources', 'sessionCacheLifetime']) {
  assert.match(report.source[key], /^[a-f0-9]{64}$/);
}
assert.equal(report.measured.sessions[0].requestedSessionOptions.graphOptimizationLevel, 'extended');
assert.equal(report.measured.sessions[0].effectiveNativeThreads, null);

failAt = calls + 2;
await assert.rejects(runOnnxProfileExperiment({ ...options, createSession }), error => error === failure);
assert.equal(active, 0); assert.equal(disposed, loaded, 'failed reference acquisition releases every acquired session');
failAt = Infinity; controller = new AbortController();
await assert.rejects(runOnnxProfileExperiment({ ...options, createSession, signal: controller.signal }), { name: 'AbortError' });
assert.equal(disposed, loaded, 'cancellation drains inference before disposal and lease release');
await assert.rejects(runOnnxProfileExperiment({ ...options, createSession, texts: ['x'.repeat(65537)] }), { code: 'ERR_ONNX_PROFILE_EXPERIMENT' });
await assert.rejects(runOnnxProfileExperiment({ ...options, createSession, candidate: { ...candidate, sessions: 2 } }), { code: 'ERR_ONNX_QUALIFICATION_PROFILE' });

// Immutable primary/cleanup failures and their original lease settlement must
// survive the experiment boundary without mutation or false success.
controller = null;
const primary = Object.freeze(new Error('frozen profile inference failure'));
const cleanup = Object.freeze(new Error('frozen profile disposal failure'));
let failedSession, refuseCleanup = true;
const createFailedSession = input => {
  const slot = acquireOnnxQualificationSlot(input.qualificationLease, { modelArtifact: input.modelArtifact, modelPath,
    lowMemory: false, processing: resolveOnnxEmbeddingProcessing(input.modelId) });
  failedSession = { embedderPromise: Promise.resolve(), getEmbeddings: async () => { throw primary; },
    executionInfo: () => ({}), dispose: async () => { if (refuseCleanup) throw cleanup; slot.release(); } };
  return failedSession;
};
const retained = await runOnnxProfileExperiment({ ...options, createSession: createFailedSession })
  .then(() => assert.fail('failed experiment must reject'), error => error);
const contains = (error, target) => error === target || Array.isArray(error?.errors) && error.errors.some(value => contains(value, target));
assert(contains(retained, primary)); assert(contains(retained, cleanup));
assert.equal(observeEmbeddingOwnership(retained)(), false);
assert.equal(primary.cleanupErrors, undefined); assert.equal(cleanup.cacheOwnershipPending, undefined);
refuseCleanup = false; await failedSession.dispose();
assert.equal(observeEmbeddingOwnership(retained)(), true, 'original closed qualification lease observes actual slot settlement');
await runOnnxProfileExperiment({ ...options, createSession: input => {
  const session = createSession(input); session.getEmbeddings = async () => { throw undefined; }; return session;
} }).then(() => assert.fail('falsey inference failure cannot publish a report'), error => assert.equal(error, undefined));
console.log('inert ONNX profile association, parity, cancellation and disposal assertions complete');
