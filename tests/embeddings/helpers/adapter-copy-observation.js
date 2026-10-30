import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { preserveEmbeddingCleanupFailure } from '../../../src/shared/embedding-cache-lifetime.js';

/** Separate actual-inference work pass. Original constructors, slice and tensor
 * disposal still execute; no timings from this instrumented pass are latency.
 */
export const observeAdapterCopies = async ({ transformers, ort = null, provider = 'xenova', operation, rows, dimensions, miniLm }) => {
  assert.ok(['xenova', 'onnx'].includes(provider));
  const Float = globalThis.Float32Array, ownSlice = Object.getOwnPropertyDescriptor(Float.prototype, 'slice');
  const slice = Float.prototype.slice;
  const tensorPrototype = (provider === 'onnx' ? ort : transformers).Tensor.prototype;
  const tensorDispose = Object.getOwnPropertyDescriptor(tensorPrototype, 'dispose');
  assert.equal(typeof slice, 'function'); assert.equal(typeof tensorDispose.value, 'function');
  const events = [], views = [], buffers = new WeakMap(), disposedBuffers = new WeakSet(), disposals = [], identities = new WeakMap();
  let nextBufferId = 0;
  const bufferId = buffer => { if (!identities.has(buffer)) identities.set(buffer, nextBufferId++); return identities.get(buffer); };
  const record = (value, kind, owned = true) => {
    const stack = new Error().stack || '';
    // runOnnxEmbeddingSession shares output.js with the decoder. Native run
    // allocations are outside this copy scope even when that file is deeper
    // in their stack; require the actual direct constructor's decoder caller.
    const origin = stack.split('\n').slice(1).find(frame => !frame.includes('adapter-copy-observation.js')) || '';
    if (provider === 'onnx' && owned && (!origin.includes('decodeOnnxEmbeddingOutput') || !origin.includes('onnx-embeddings/output.js'))) return value;
    const owner = provider === 'onnx' && stack.includes('decodeOnnxEmbeddingOutput') ? 'current-direct-onnx-host-pooling'
      : stack.includes('embedding-output-admission.js') ? 'current-output-admission'
        : stack.includes('embedding-utils.js') ? 'original-output-normalizer'
          : stack.includes('normalizeEmbeddingGemma2Output') ? 'qualified-eg2-projection' : null;
    if (!owner) return value;
    if (!owned) {
      assert.ok(views.length < 2048, 'Bound owner-attributed view observations.');
      views.push({ owner, kind: 'buffer-view', bufferId: bufferId(value.buffer), bytes: value.byteLength, elements: value.length }); return value;
    }
    if (buffers.has(value.buffer)) return value;
    const event = { owner, kind, bufferId: bufferId(value.buffer), bytes: value.byteLength, elements: value.length };
    buffers.set(value.buffer, event); events.push(event); return value;
  };
  let vectors, failure, failed = false;
  try {
    globalThis.Float32Array = new Proxy(Float, { construct(target, args, constructor) {
      const view = args[0] instanceof ArrayBuffer || typeof SharedArrayBuffer === 'function' && args[0] instanceof SharedArrayBuffer;
      return record(Reflect.construct(target, args, constructor), 'constructor', !view);
    } });
    Object.defineProperty(Float.prototype, 'slice', { configurable: true, writable: true, enumerable: false, ...ownSlice, value: function (...args) {
      return record(Reflect.apply(slice, this, args), 'slice');
    } });
    Object.defineProperty(tensorPrototype, 'dispose', { ...tensorDispose, value: function (...args) {
      const shape = [...this.dims], data = this.data;
      const output = provider === 'onnx' ? ['float32', 'float64'].includes(this.type)
        && [2, 3].includes(shape.length) && shape[0] === rows && shape.at(-1) === dimensions
        : shape.length === 2 && shape[0] === rows && shape[1] === (miniLm ? dimensions : 768);
      const row = provider === 'onnx' || output ? { provider, role: output ? 'output' : 'input', dtype: this.type,
        dimensions: shape, bufferId: bufferId(data.buffer), bytes: data.byteLength, originalReturned: false,
        ...(provider === 'onnx' && output ? { sha256: createHash('sha256')
          .update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex') } : {}) } : null;
      if (row) { disposals.push(row); disposedBuffers.add(data.buffer); }
      const result = Reflect.apply(tensorDispose.value, this, args);
      if (row) {
        assert.equal(result, undefined, 'The pinned upstream Tensor.dispose contract is synchronous and returns void.');
        row.originalReturned = true;
        if (provider === 'onnx') { row.locationAfterOriginal = this.location; assert.equal(row.locationAfterOriginal, 'none'); }
      }
      return result;
    } });
    vectors = await operation();
  } catch (error) { failure = error; failed = true;
  } finally {
    for (const restore of [() => { globalThis.Float32Array = Float; },
      () => { if (ownSlice) Object.defineProperty(Float.prototype, 'slice', ownSlice); else delete Float.prototype.slice; },
      () => Object.defineProperty(tensorPrototype, 'dispose', tensorDispose)]) {
      try { restore(); } catch (error) { failure = failed ? preserveEmbeddingCleanupFailure(failure, error) : error; failed = true; }
    }
  }
  if (failed) throw failure;
  assert.equal(vectors.length, rows);
  for (const vector of vectors) assert.ok(!disposedBuffers.has(vector.buffer), 'Returned vectors must survive original pooled-tensor disposal.');
  const returnedCopies = vectors.map(vector => buffers.get(vector.buffer) || null);
  assert.equal(events.length, rows); assert.ok(returnedCopies.every(Boolean));
  assert.equal(events.reduce((sum, row) => sum + row.bytes, 0), rows * dimensions * 4);
  const outputs = disposals.filter(row => row.role === 'output');
  assert.ok(outputs.length >= 1, 'Observe the actual provider output disposal, not merely detached JS vectors.');
  if (provider === 'onnx') {
    assert.equal(outputs.length, 1, 'The pinned MiniLM graph exposes exactly last_hidden_state.');
    assert.equal(outputs[0].dimensions.length, 3); assert.equal(outputs[0].dtype, 'float32');
    assert.equal(disposals.filter(row => row.role === 'input').length, 3, 'Original direct feeds own input_ids, attention_mask and token_type_ids.');
    assert.ok(disposals.filter(row => row.role === 'input').every(row => row.dtype === 'int64'
      && row.dimensions.length === 2 && row.dimensions[0] === rows && row.dimensions[1] === outputs[0].dimensions[1]));
  }
  assert.ok(disposals.every(row => row.originalReturned));
  return { vectors, observation: { provider, events, views, returnedCopies, disposals,
    copiedBytes: events.reduce((sum, row) => sum + row.bytes, 0), outputBytes: rows * dimensions * 4,
    scope: 'Owner-attributed owned Float32 constructors and native slice results, deduplicated by backing buffer; ArrayBuffer-backed view constructions recorded separately and excluded from copy bytes. Original provider-specific Tensor.dispose observed; excludes native/internal/tokenizer allocations and other typed-array types.',
    lifetime: 'Original HF pooled or root-ORT input/output tensor disposal returned before vector checks. Root-ORT location none is its original logical disposal contract, not native memory freeing. Returned vectors are distinct from disposed source buffers and retained through correctness/serialization; no allocator-retention or native-unload claim.' } };
};
