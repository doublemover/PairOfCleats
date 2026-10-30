import assert from 'node:assert/strict';
import { buildDenseVectors } from '../../../src/index/build/postings/dense-vectors.js';
import { buildQuantizeRunPayload } from '../../../src/index/build/workers/pool/payload.js';
import { quantizeVec } from '../../../src/index/embedding.js';
import { resolveEmbeddingQuantizationSpec } from '../../../src/shared/embedding-quantization-spec.js';

const malformed = [
  () => [], () => ({}), () => null, () => undefined,
  rows => [...rows, rows[0]], rows => rows.slice(1),
  () => [null], () => [undefined], () => [[]], () => ['oops'], () => [[1]],
  () => [[NaN, Infinity]], () => [[1.5, 2]], () => [[-1, 2]], () => [[1, 256]],
  () => [Uint8Array.of(255, 255)]
];
const snapshot = result => ({ dims: result.dims, ...Object.fromEntries(
  ['quantizedVectors', 'quantizedDocVectors', 'quantizedCodeVectors'].map(channel => [channel, result[channel].map(row => [...row])])) });
for (const quantization of [{}, { minVal: -2, maxVal: 2, levels: 16 }]) {
  const spec = resolveEmbeddingQuantizationSpec(quantization);
  for (const mutate of malformed) for (const invalidBatch of [0, 1, 2]) {
    if (mutate === malformed.at(-1) && spec.levels === 256) continue;
    const sources = [Float32Array.of(.1, .2), Float32Array.of(-.3, .4), Float32Array.of(.6, -.7)];
    const snapshots = sources.map(row => row.slice());
    const chunks = [{ embedding_u8: Uint8Array.of(1, 2), embed_doc_u8: new Uint8Array(0), embed_code_u8: Uint8Array.of(3, 4) },
      ...sources.map(embedding => ({ embedding, embed_doc: null, embed_code: embedding }))];
    const expected = await buildDenseVectors({ chunks, quantization });
    const logs = []; let calls = 0;
    const actual = await buildDenseVectors({ chunks, quantization, log: message => logs.push(message), quantizePool: {
      config: { quantizeBatchSize: 1 },
      async runQuantize(payload) {
        assert.ok(Object.isFrozen(payload.quantization));
        assert.deepEqual([payload.minVal, payload.maxVal, payload.levels], [spec.minVal, spec.maxVal, spec.levels]);
        const transfer = buildQuantizeRunPayload(payload);
        const received = structuredClone(transfer.payload, { transfer: transfer.transferList });
        const rows = received.vectors.map(vector => quantizeVec(vector, received.minVal, received.maxVal, received.levels));
        return calls++ === invalidBatch ? mutate(rows) : rows.map(row => Uint8Array.from(row));
      }
    } });
    assert.deepEqual(snapshot(actual), snapshot(expected), 'complete malformed batch recovers every channel and ordinal');
    sources.forEach((row, index) => { assert.equal(row.byteLength, 8); assert.deepEqual(row, snapshots[index]); });
    assert.equal(logs.filter(message => message.includes('falling back to inline')).length, 1);
  }
}
for (const fail of [
  () => new Error('ordinary settled rejection'),
  () => new AggregateError([new Error('first settled failure'), new Error('second settled failure')], 'settled batch failure'),
  () => null
]) {
  const chunks = [{ embedding: Float32Array.of(.1, .2) }];
  const expected = await buildDenseVectors({ chunks });
  assert.deepEqual(await buildDenseVectors({ chunks, quantizePool: { async runQuantize() {
    const error = fail(); if (error) throw error; return null;
  } } }), expected);
}
for (const typed of [false, true]) {
  const chunks = [{ embedding: [.1, .2] }, { embedding: [.3, .4] }];
  const quantization = { minVal: -2, maxVal: 2, levels: 16 };
  const expected = await buildDenseVectors({ chunks, quantization });
  const logs = [];
  const actual = await buildDenseVectors({ chunks, quantization, log: message => logs.push(message), quantizePool: {
    config: { quantizeBatchSize: 2 }, async runQuantize({ vectors, minVal, maxVal, levels }) {
      return vectors.map(vector => { const row = quantizeVec(vector, minVal, maxVal, levels); return typed ? Uint8Array.from(row) : row; });
    }
  } });
  assert.deepEqual(snapshot(actual), snapshot(expected));
  assert.ok(!logs.some(message => message.includes('falling back to inline')));
}
{
  const chunks = [{ embedding: [.1, .2] }, { embedding: [.3, .4] }];
  const expected = await buildDenseVectors({ chunks });
  const actual = await buildDenseVectors({ chunks, quantizePool: { config: { quantizeBatchSize: 2 },
    async runQuantize() { return [[0, 0], [NaN, 2]]; } } });
  assert.deepEqual(snapshot(actual), snapshot(expected), 'a late invalid row also discards earlier valid-looking rows in that batch');
}
for (const code of ['ABORT_ERR', 'ERR_PROCESS_TASK_BUDGET', 'ERR_TOKENIZER_RESOURCE_PRESSURE',
  'ERR_WORKER_POOL_CLEANUP_UNCONFIRMED', 'ERR_WORKER_POOL_CLEANUP_TIMEOUT', 'BUILD_CLEANUP_TIMEOUT',
  'PISCINA_DESTROY_TIMEOUT', 'PISCINA_WORKER_TERMINATE_TIMEOUT', 'PISCINA_FORCE_TERMINATE_INCOMPLETE',
  'ERR_SCHEDULER_COMPUTE_NOT_ADMITTED', 'ERR_SCHEDULER_CPU_REACQUIRE']) {
  const error = Object.assign(new Error(code), { code });
  await assert.rejects(buildDenseVectors({ chunks: [{ embedding: [.1, .2] }],
    quantizePool: { async runQuantize() { throw error; } } }), actual => actual === error);
}
{
  const original = Object.assign(new Error('original resource still pending'), { cacheOwnershipPending: false,
    cacheOwnershipReleased() { assert.equal(this, original); return false; } });
  const failure = new AggregateError([new Error('settled sibling'), new Error('wrapped', { cause: original })], 'nested resource failure');
  await assert.rejects(buildDenseVectors({ chunks: [{ embedding: [.1, .2] }],
    quantizePool: { async runQuantize() { throw failure; } } }), actual => actual === failure);
}
const controller = new AbortController();
await assert.rejects(buildDenseVectors({ chunks: [{ embedding: [.1, .2] }], abortSignal: controller.signal,
  quantizePool: { async runQuantize() { controller.abort(); return []; } } }), error => error.code === 'ABORT_ERR' || error.name === 'AbortError');
const abortWithCleanup = new AbortController();
const cancellation = Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'ABORT_ERR' });
const unresolved = Object.assign(new AggregateError([cancellation, new Error('native cleanup pending')], 'cleanup unresolved'), {
  code: 'ERR_WORKER_POOL_CLEANUP_UNCONFIRMED', workerOwnershipPending: true
});
await assert.rejects(buildDenseVectors({ chunks: [{ embedding: [.1, .2] }], abortSignal: abortWithCleanup.signal,
  quantizePool: { async runQuantize() { abortWithCleanup.abort(cancellation); throw unresolved; } } }), error => error === unresolved,
'a simultaneous abort must not erase unresolved cleanup evidence');
await assert.rejects(buildDenseVectors({ chunks: [{ embedding_u8: Uint8Array.of(255, 1) }],
  quantization: { levels: 16 } }), /Invalid quantized value/);
console.log('Dense worker candidates are admitted atomically and settled malformed batches recover with the effective codec.');
