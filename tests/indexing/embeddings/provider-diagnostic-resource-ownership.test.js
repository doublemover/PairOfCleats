import assert from 'node:assert/strict';
import { createXenovaAdapter } from '../../../src/shared/embedding-provider-adapters.js';
import { createOnnxResourceOwner } from '../../../src/shared/onnx-embeddings/resource-lifetime.js';
import { isDlopenFailure } from '../../../src/shared/embedding-adapter-helpers.js';

// Actual provider/output cleanup and ONNX resource release, inert native methods.
const controls = [], adapters = [], owners = [];
const contains = (value, expected, seen = new Set()) => {
  if (value === expected) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return contains(value.cause, expected, seen) || Array.isArray(value.errors) && value.errors.some(child => contains(child, expected, seen));
};
const control = mode => {
  let settled = false, substitute = false, observerReads = 0;
  const inspection = new Error('controlled diagnostic operation retains its original resource');
  Object.defineProperties(inspection, { cacheOwnershipPending: { value: false }, cacheOwnershipReleased: { get() {
    observerReads++; return substitute ? () => true : function () { assert.equal(this, inspection); return settled; };
  } } }); Object.freeze(inspection);
  const original = Object.assign(new Error('original native cleanup failure'), { nativeCapability: { original: true } });
  const primary = new Proxy(original, {
    ownKeys(target) { if (mode === 'keys') throw inspection; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { if (mode === 'descriptor' && key === 'nativeCapability') throw inspection; return Reflect.getOwnPropertyDescriptor(target, key); }
  });
  const result = { primary, inspection, substitute: () => { substitute = true; }, settle: () => { settled = true; }, observerReads: () => observerReads };
  controls.push(result); return result;
};
try {
  assert.equal(isDlopenFailure(new Error('outer settled native error', { cause: Object.assign(new Error('settled nested error'), { code: 'ERR_DLOPEN_FAILED' }) })), true);
  let nestedSettled = false;
  const nested = Object.freeze(Object.assign(new Error('pending nested native error'), { code: 'ERR_DLOPEN_FAILED',
    cacheOwnershipReleased: () => nestedSettled }));
  const original = new Error('outer native error retains nested work', { cause: nested });
  let retained;
  assert.throws(() => isDlopenFailure(original), error => { retained = error; return contains(error, original) && contains(error, nested); });
  assert.equal(retained.cacheOwnershipReleased(), false); nestedSettled = true; assert.equal(retained.cacheOwnershipReleased(), true);
  for (const mode of ['keys', 'descriptor']) {
    const value = control(mode); let outputCloses = 0, pipelineCloses = 0;
    const output = { dims: [1, 2], type: 'float32', data: Float32Array.of(3, 4), dispose() {
      if (++outputCloses === 1) throw value.primary;
    } };
    const adapter = createXenovaAdapter({ modelId: 'fixture/diagnostic-output', loadPipeline: async () => Object.assign(async () => output, {
      dispose() { pipelineCloses++; }
    }) }); adapters.push(adapter);
    const failure = await adapter.embedOne('diagnostic output').then(() => assert.fail('cleanup must reject'), error => error);
    assert(contains(failure, value.primary)); assert(contains(failure, value.inspection));
    assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(outputCloses, 1);
    value.substitute();
    await assert.rejects(adapter.dispose()); await assert.rejects(adapter.dispose());
    assert.equal(outputCloses, 1, 'pending diagnostic work cannot authorize repeating native output disposal');
    assert.equal(pipelineCloses, 0); assert.equal(value.observerReads(), 1);
    value.settle(); await adapter.dispose(); assert.equal(outputCloses, 2); assert.equal(pipelineCloses, 1);
    assert.equal(failure.cacheOwnershipReleased(), true);

    const native = control(mode); let sessionCloses = 0, tokenizerCloses = 0, capacityCloses = 0;
    const owner = createOnnxResourceOwner({ session: { release() { if (++sessionCloses === 1) throw native.primary; } },
      tokenizer: { dispose() { tokenizerCloses++; } }, qualificationSlot: { release() { capacityCloses++; } } }); owners.push(owner);
    const nativeFailure = await owner.release().then(() => assert.fail('native cleanup must reject'), error => error);
    assert(contains(nativeFailure, native.primary)); assert(contains(nativeFailure, native.inspection));
    native.substitute(); await assert.rejects(owner.release());
    assert.equal(sessionCloses, 1); assert.equal(tokenizerCloses, 0); assert.equal(capacityCloses, 0);
    native.settle(); await owner.release(); assert.equal(sessionCloses, 2); assert.equal(tokenizerCloses, 1); assert.equal(capacityCloses, 1);
    assert.equal(nativeFailure.cacheOwnershipReleased(), true); assert.equal(native.observerReads(), 1);
  }
} finally {
  for (const value of controls) value.settle();
  await Promise.allSettled(adapters.map(adapter => adapter.dispose())); await Promise.allSettled(owners.map(owner => owner.release()));
}
console.log('Actual provider/native cleanup retains descriptor/key inspection resources and original observers; execution deferred.');
