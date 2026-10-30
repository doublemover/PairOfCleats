import assert from 'node:assert/strict';
import path from 'node:path';
import { DIRECT_MINILM_ARTIFACTS, assertDirectMiniLmManifest, assertDirectMiniLmRoute, createDirectMiniLmReference,
  directMiniLmSessionOptions, scalarDirectMiniLmReference } from './helpers/direct-minilm-reference.js';
import { compareMiniLmReferenceVectors } from './helpers/minilm-upstream-reference.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { observeEmbeddingOwnership } from '../../src/shared/embedding-cache-lifetime.js';

applyTestEnv();
// Finite metadata, independent arithmetic and controlled original component
// lifetime tests only. No installed graph, native binding or inference executes.
const manifest = { modelId: 'Xenova/all-MiniLM-L6-v2', provider: 'onnx', dimensions: 384, normalize: true, tolerance: 1e-5,
  modelProfile: null, modelsDir: path.resolve('metadata-only-tokenizer-cache'),
  runtime: { transformers: '4.3.2', onnxruntimeNode: '1.30.0' }, providerRuntime: { name: 'onnxruntime-node', version: '1.30.0' },
  artifacts: structuredClone(DIRECT_MINILM_ARTIFACTS), onnxConfig: { modelPath: path.resolve('metadata-only-install/model_quantized.onnx'),
    tokenizerId: 'Xenova/all-MiniLM-L6-v2', executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1,
    graphOptimizationLevel: 'basic', cpuExecutionProviderTuning: true } };
assertDirectMiniLmManifest(manifest);
for (const route of ['upstream-reference', 'single', 'batch', 'query', 'resources']) assertDirectMiniLmRoute(route);
assert.throws(() => assertDirectMiniLmRoute('prepared'), /no public prepare/);
for (const change of [value => { value.provider = 'xenova'; }, value => { value.modelId = 'local/minilm-alias'; },
  value => { value.dimensions = 383; }, value => { value.normalize = false; }, value => { value.tolerance = 1e-4; },
  value => { value.modelProfile = {}; }, value => { value.providerRuntime.version = '1.31.1'; },
  value => { value.runtime.onnxruntimeNode = '1.31.1'; }, value => { value.onnxConfig.intraOpNumThreads = 2; },
  value => { value.onnxConfig.tokenizerId = 'other/tokenizer'; }, value => { value.onnxConfig.modelPath = 'relative/model_quantized.onnx'; },
  value => { value.artifacts[0].sha256 = 'a'.repeat(64); }, value => { value.artifacts[3].path = 'onnx/model_quantized.onnx'; }]) {
  const changed = structuredClone(manifest); change(changed); assert.throws(() => assertDirectMiniLmManifest(changed));
}
const backing = new Float32Array(2 * 3 * 384 + 4); backing.fill(Infinity, 2 * 3 * 384);
const hidden = { type: 'float32', dims: [2, 3, 384], data: backing.subarray(0, 2 * 3 * 384) };
hidden.data[0] = 3; hidden.data[1] = 4; hidden.data[384] = 5; hidden.data[385] = 12; hidden.data[768] = 999;
hidden.data[1152] = 1; hidden.data[1537] = 1; hidden.data[1920] = 999;
const mask = { type: 'int64', dims: [2, 3], data: BigInt64Array.of(1n, 1n, 0n, 1n, 1n, 0n) };
const expected = scalarDirectMiniLmReference({ hidden, mask, count: 2 });
assert.ok(Math.abs(expected.vectors[0][0] - 1 / Math.sqrt(5)) < 1e-6);
assert.ok(Math.abs(expected.vectors[1][0] - 1 / Math.sqrt(2)) < 1e-6); assert.deepEqual(expected.tokenCounts, [2, 2]);
for (const overrides of [{ type: 'float64' }, { dims: [2, 384] }, { dims: [2, 3, 383] }, { dims: [2, 2.5, 384] },
  { data: hidden.data.subarray(0, hidden.data.length - 1) }, { data: new Float32Array(hidden.data.length) }]) {
  assert.throws(() => scalarDirectMiniLmReference({ hidden: { ...hidden, ...overrides }, mask, count: 2 }));
}
for (const values of [[1n, 2n, 0n, 1n, 1n, 0n], [0n, 0n, 0n, 1n, 1n, 0n]]) {
  assert.throws(() => scalarDirectMiniLmReference({ hidden, mask: { ...mask, data: BigInt64Array.from(values) }, count: 2 }));
}
const maskedNonfinite = { ...hidden, data: new Float32Array(hidden.data) }; maskedNonfinite.data[768] = Infinity;
assert.throws(() => scalarDirectMiniLmReference({ hidden: maskedNonfinite, mask, count: 2 }));
const components = ({ controller = null, abortAt = null, malformed = false, cleanupFailure = null, runGate = null, runEntered = null } = {}) => {
  const closed = [], calls = [], disposeAttempts = [], disposedTensors = new Set(); let firstCleanup = true;
  class Tensor {
    constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; }
    dispose() {
      assert.equal(disposedTensors.has(this), false, 'confirmed tensor disposal cannot be replayed');
      disposeAttempts.push(this);
      if (cleanupFailure && firstCleanup) { firstCleanup = false; throw cleanupFailure; }
      disposedTensors.add(this);
      closed.push(this.type); if (this.data instanceof Float32Array) this.data.fill(NaN);
    }
  }
  const tokenizer = Object.assign((texts, options) => {
    calls.push(['tokenize', texts, options]);
    return { input_ids: [[101, 10, 0], [101, 11, 0]], attention_mask: [[1, 1, 0], [1, 1, 0]], token_type_ids: [[0, 0, 0], [0, 0, 0]] };
  }, { pad_token_id: 0, dispose() { closed.push('tokenizer'); } });
  const session = { inputNames: ['input_ids', 'attention_mask', 'token_type_ids'], outputNames: ['last_hidden_state'],
    async run(feeds, names) {
      assert.deepEqual(names, ['last_hidden_state']); assert.deepEqual(feeds.input_ids.dims, [2, 3]);
      assert.deepEqual([...feeds.attention_mask.data], [...mask.data]);
      runEntered?.(); if (runGate) await runGate;
      if (abortAt === 'run') controller.abort();
      return { last_hidden_state: new Tensor('float32', new Float32Array(hidden.data), malformed ? [2, 384] : [2, 3, 384]) };
    }, release() { closed.push('session'); } };
  const transformers = { AutoConfig: { async from_pretrained(id, options) {
    calls.push(['config', id, options]); return { model_type: 'bert', hidden_size: 384, max_position_embeddings: 512 };
  } }, AutoTokenizer: { async from_pretrained(id, options) {
    calls.push(['tokenizer', id, options]); if (abortAt === 'tokenizer') controller.abort(); return tokenizer;
  } } };
  const runtime = { Tensor, InferenceSession: { async create(file, options) {
    calls.push(['session', file, options]); if (abortAt === 'session') controller.abort(); return session;
  } } };
  return { transformers, runtime, session, tokenizer, closed, calls, disposeAttempts, disposedTensors };
};
const create = (control, signal) => createDirectMiniLmReference({ ...control, manifest,
  selectedGraph: manifest.onnxConfig.modelPath, signal });
const control = components(), reference = await create(control);
const result = await reference.embed(['first', '第二段']);
compareMiniLmReferenceVectors(result.vectors, expected.vectors, 1e-5);
assert.deepEqual(control.calls.find(row => row[0] === 'tokenize')[2],
  { padding: true, truncation: true, return_tensor: false, return_token_type_ids: true });
assert.deepEqual(control.calls.find(row => row[0] === 'session')[2], directMiniLmSessionOptions());
for (const call of control.calls.filter(row => ['config', 'tokenizer'].includes(row[0]))) {
  assert.equal(call[1], manifest.modelId); assert.deepEqual(call[2], { cache_dir: manifest.modelsDir, local_files_only: true });
}
assert.equal(control.closed.filter(value => value === 'int64').length, 3); assert.equal(control.closed.filter(value => value === 'float32').length, 1);
control.session.release = () => assert.fail('must retain original session release');
control.tokenizer.dispose = () => assert.fail('must retain original tokenizer disposal');
await reference.close(); assert.deepEqual(control.closed.slice(-2), ['session', 'tokenizer']);
await assert.rejects(reference.embed(['late']), /closed/);
for (const abortAt of ['tokenizer', 'session', 'run']) {
  const controller = new AbortController(), cancelled = components({ controller, abortAt });
  if (abortAt === 'run') {
    const active = await create(cancelled, controller.signal);
    await assert.rejects(active.embed(['first', '第二段']), { name: 'AbortError' }); await active.close();
    assert.equal(cancelled.closed.filter(value => value === 'int64').length, 3); assert.ok(cancelled.closed.includes('float32'));
  } else await assert.rejects(create(cancelled, controller.signal), { name: 'AbortError' });
  assert.deepEqual(cancelled.closed.slice(-2), abortAt === 'tokenizer' ? ['tokenizer'] : ['session', 'tokenizer']);
}
const invalid = components({ malformed: true }), invalidReference = await create(invalid);
await assert.rejects(invalidReference.embed(['first', '第二段']), { code: 'ERR_ASSERTION' }); await invalidReference.close();
assert.ok(invalid.closed.includes('float32')); assert.deepEqual(invalid.closed.slice(-2), ['session', 'tokenizer']);
const originalCleanupFailure = Object.assign(new Error('original raw feed cleanup'), { code: 'RAW_FEED_CLOSE' });
const inspectCauses = value => {
  const causes = new Set(), visit = error => {
    if (!error || causes.has(error)) return; causes.add(error); assert.ok(causes.size < 24);
    visit(error.cause); for (const member of error.errors || []) visit(member);
  };
  visit(value); return causes;
};
const reconcileFailedCleanup = async (active, component, operationFailure) => {
  const operationReleased = observeEmbeddingOwnership(operationFailure); assert.equal(operationReleased(), false);
  assert.equal(component.disposeAttempts.length, 4); assert.equal(component.disposedTensors.size, 3);
  let firstCloseFailure;
  // The first session-owner release reports its already failed tensor scope.
  // It does not authorize replay of any disposer, or release native parents.
  await assert.rejects(active.close(), error => {
    firstCloseFailure = error; assert.equal(error.code, 'RAW_FEED_CLOSE');
    assert.ok(inspectCauses(error).has(originalCleanupFailure)); return true;
  });
  const closeReleased = observeEmbeddingOwnership(firstCloseFailure); assert.equal(closeReleased(), false);
  assert.equal(component.disposeAttempts.length, 4);
  assert.equal(component.closed.includes('session'), false); assert.equal(component.closed.includes('tokenizer'), false);
  // Explicitly retry the same original owner. Only the unconfirmed failed
  // output disposal may retry; all confirmed physical releases stay once.
  await active.close();
  assert.equal(operationReleased(), true); assert.equal(closeReleased(), true);
  assert.equal(component.disposeAttempts.length, 5); assert.equal(component.disposedTensors.size, 4);
  const attempts = new Map(); for (const tensor of component.disposeAttempts) attempts.set(tensor, (attempts.get(tensor) || 0) + 1);
  assert.deepEqual([...attempts.values()].sort(), [1, 1, 1, 2]);
  assert.deepEqual(component.closed.slice(-2), ['session', 'tokenizer']);
  await active.close(); assert.equal(component.disposeAttempts.length, 5);
  assert.equal(component.closed.filter(name => name === 'session').length, 1);
  assert.equal(component.closed.filter(name => name === 'tokenizer').length, 1);
};
const failedCleanup = components({ cleanupFailure: originalCleanupFailure }), cleanupReference = await create(failedCleanup);
let cleanupOperationFailure;
await assert.rejects(cleanupReference.embed(['first', '第二段']), error => {
  cleanupOperationFailure = error; assert.equal(error.code, 'RAW_FEED_CLOSE'); return true;
});
await reconcileFailedCleanup(cleanupReference, failedCleanup, cleanupOperationFailure);
const bothFailures = components({ malformed: true, cleanupFailure: originalCleanupFailure }), joinedReference = await create(bothFailures);
let joined;
try { await joinedReference.embed(['first', '第二段']); } catch (error) { joined = error; }
assert.equal(joined?.code, 'ERR_ASSERTION');
assert.ok(inspectCauses(joined).has(originalCleanupFailure), 'original validation and exact independent cleanup failure remain attached');
await reconcileFailedCleanup(joinedReference, bothFailures, joined);
let enterRun, releaseRun;
const entered = new Promise(resolve => { enterRun = resolve; }), admittedRun = new Promise(resolve => { releaseRun = resolve; });
const pendingControl = components({ runGate: admittedRun, runEntered: enterRun }), pendingReference = await create(pendingControl);
const originalWork = pendingReference.embed(['first', '第二段']); await entered;
let closeSettled = false;
const originalClose = pendingReference.close().then(() => { closeSettled = true; });
await Promise.resolve(); assert.equal(closeSettled, false); assert.equal(pendingControl.closed.includes('session'), false);
releaseRun(); await originalWork; await originalClose;
assert.deepEqual(pendingControl.closed.slice(-2), ['session', 'tokenizer'], 'close joins admitted native work before original component release');
console.log('Direct MiniLM finite metadata, independent arithmetic and controlled cleanup/cancellation passed;no actual export qualification implied.');
