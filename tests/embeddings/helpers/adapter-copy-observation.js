import assert from 'node:assert/strict';
import { preserveEmbeddingCleanupFailure } from '../../../src/shared/embedding-cache-lifetime.js';

/** Separate actual-inference work pass. Original constructors, slice and tensor
 * disposal still execute; no timings from this instrumented pass are latency.
 */
export const observeAdapterCopies = async ({ transformers, operation, rows, dimensions, miniLm }) => {
  const Float = globalThis.Float32Array, ownSlice = Object.getOwnPropertyDescriptor(Float.prototype, 'slice');
  const slice = Float.prototype.slice;
  const tensorDispose = Object.getOwnPropertyDescriptor(transformers.Tensor.prototype, 'dispose');
  assert.equal(typeof slice, 'function'); assert.equal(typeof tensorDispose.value, 'function');
  const events = [], buffers = new WeakMap(), disposedBuffers = new WeakSet(), disposals = [];
  const record = (value, kind) => {
    const stack = new Error().stack || '';
    const owner = stack.includes('embedding-output-admission.js') ? 'current-output-admission'
      : stack.includes('embedding-utils.js') ? 'original-output-normalizer'
        : stack.includes('normalizeEmbeddingGemma2Output') ? 'qualified-eg2-projection' : null;
    if (!owner || buffers.has(value.buffer)) return value;
    const event = { owner, kind, bytes: value.byteLength, elements: value.length };
    buffers.set(value.buffer, event); events.push(event); return value;
  };
  let vectors, failure, failed = false;
  try {
    globalThis.Float32Array = new Proxy(Float, { construct(target, args, constructor) {
      return record(Reflect.construct(target, args, constructor), 'constructor');
    } });
    Object.defineProperty(Float.prototype, 'slice', { configurable: true, writable: true, enumerable: false, ...ownSlice, value: function (...args) {
      return record(Reflect.apply(slice, this, args), 'slice');
    } });
    Object.defineProperty(transformers.Tensor.prototype, 'dispose', { ...tensorDispose, value: function (...args) {
      const shape = [...this.dims], data = this.data;
      const pooled = shape.length === 2 && shape[0] === rows && shape[1] === (miniLm ? dimensions : 768);
      const row = pooled ? { dimensions: shape, bytes: data.byteLength, originalReturned: false } : null;
      if (row) { disposals.push(row); disposedBuffers.add(data.buffer); }
      const result = Reflect.apply(tensorDispose.value, this, args);
      if (row) {
        assert.equal(result, undefined, 'The pinned upstream Tensor.dispose contract is synchronous and returns void.');
        row.originalReturned = true;
      }
      return result;
    } });
    vectors = await operation();
  } catch (error) { failure = error; failed = true;
  } finally {
    for (const restore of [() => { globalThis.Float32Array = Float; },
      () => { if (ownSlice) Object.defineProperty(Float.prototype, 'slice', ownSlice); else delete Float.prototype.slice; },
      () => Object.defineProperty(transformers.Tensor.prototype, 'dispose', tensorDispose)]) {
      try { restore(); } catch (error) { failure = failed ? preserveEmbeddingCleanupFailure(failure, error) : error; failed = true; }
    }
  }
  if (failed) throw failure;
  assert.equal(vectors.length, rows);
  for (const vector of vectors) assert.ok(!disposedBuffers.has(vector.buffer), 'Returned vectors must survive original pooled-tensor disposal.');
  const returnedCopies = vectors.map(vector => buffers.get(vector.buffer) || null);
  assert.equal(events.length, rows); assert.ok(returnedCopies.every(Boolean));
  assert.equal(events.reduce((sum, row) => sum + row.bytes, 0), rows * dimensions * 4);
  assert.ok(disposals.length >= 1, 'Observe original MiniLM pooled or EG2 768-wide sentence tensor disposal, not merely detached JS vectors.');
  assert.ok(disposals.every(row => row.originalReturned));
  return { vectors, observation: { events, returnedCopies, disposals,
    copiedBytes: events.reduce((sum, row) => sum + row.bytes, 0), outputBytes: rows * dimensions * 4,
    scope: 'Owner-attributed Float32 constructors and native slice results, deduplicated by backing buffer; original upstream pooled Tensor.dispose return observed. Excludes native/internal/tokenizer allocations and other typed-array types.',
    lifetime: 'Original pooled tensor disposal settled before returned vectors were checked; retained vectors intentionally survive through correctness comparison and receipt serialization. No allocator-retention or native-unload claim.' } };
};
