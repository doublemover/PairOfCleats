import assert from 'node:assert/strict';
import { selectOnnxEmbeddingOutput, runOnnxEmbeddingSession, decodeOnnxEmbeddingOutput } from '../../../src/shared/onnx-embeddings/output.js';
import { normalizeEmbeddingVectorInPlace } from '../../../src/shared/embedding-utils.js';

const metadata = (name, shape, type = 'float32') => ({ name, shape, type, isTensor: true });
const sentence = { type: 'float32', dims: [2, 3], data: Float32Array.of(1, 2, 3, 0, 0, 0) };
let selectedCalls = 0;
const selectedSession = { outputNames: ['last_hidden_state', 'sentence_embedding', 'logits'],
  outputMetadata: [metadata('last_hidden_state', ['batch', 'sequence', 3]), metadata('sentence_embedding', ['batch', 3]), metadata('logits', ['batch', 4096])],
  run: async (feeds, fetches) => {
    selectedCalls++; assert.deepEqual(fetches, ['sentence_embedding']); assert.equal(feeds.marker, 'input');
    return { sentence_embedding: sentence };
  } };
const work = {};
const outputs = await runOnnxEmbeddingSession({ session: selectedSession, feeds: { marker: 'input' }, measurements: work });
assert.equal(selectedCalls, 1); assert.equal(work.selectiveOutputRuns, 1);
assert.equal(work.outputsFetched, 1); assert.equal(work.outputTensorBytes, 24);
const rows = decodeOnnxEmbeddingOutput({ outputs, count: 2, normalizeVector: value => value, measurements: work });
assert.deepEqual(rows.map(row => Array.from(row)), [[1, 2, 3], [0, 0, 0]]);
assert.equal(work.hostPooledRows, 0); assert.equal(work.sentenceOutputRows, 2);
assert.equal(work.outputValuesRead, 6);
rows[0][0] = 99; assert.equal(sentence.data[0], 1, 'returned vectors own their buffer independently of runtime tensors');

for (const value of [
  { outputNames: ['unknown'], outputMetadata: [metadata('unknown', [2, 3])] },
  { outputNames: ['embeddings'], outputMetadata: [] },
  { outputNames: ['embeddings'], outputMetadata: [metadata('embeddings', [2, 3], 'int64')] },
  { outputNames: ['embeddings'], outputMetadata: [metadata('embeddings', [2, 3, 4, 5])] },
  { outputNames: ['embeddings', 'embeddings'], outputMetadata: [metadata('embeddings', [2, 3])] }
]) {
  let genericCalls = 0;
  const session = { ...value, run: async (...args) => { genericCalls++; assert.equal(args.length, 1); return { output_0: sentence }; } };
  assert.equal(selectOnnxEmbeddingOutput(session), null);
  await runOnnxEmbeddingSession({ session, feeds: {}, measurements: work });
  assert.equal(genericCalls, 1, 'unsupported metadata keeps the generic fetch path');
}
const failure = new Error('controlled selected fetch failure'); let attempts = 0;
await assert.rejects(runOnnxEmbeddingSession({ session: { ...selectedSession,
  run: async () => { attempts++; throw failure; } }, feeds: {} }), error => error === failure);
assert.equal(attempts, 1, 'fetch failure does not retry inference or hide the provider error');
await assert.rejects(runOnnxEmbeddingSession({ session: { ...selectedSession, run: async () => ({}) }, feeds: {} }), { code: 'ERR_ONNX_EMBEDDING_OUTPUT' });

// Independent loop retains the baseline's Float32 rounding after each addition.
const reference = (data, [batch, sequence, width], mask, normalize) => {
  const output = [];
  for (let row = 0; row < batch; row++) {
    const value = new Float32Array(width); let count = 0;
    for (let token = 0; token < sequence; token++) {
      if (mask && !Number(mask[row]?.[token] ?? 0)) continue;
      count++;
      for (let column = 0; column < width; column++) value[column] += data[(row * sequence + token) * width + column];
    }
    if (count) for (let column = 0; column < width; column++) value[column] /= count;
    output.push(normalize ? normalizeEmbeddingVectorInPlace(value) : value);
  }
  return output;
};
const shape = [3, 4, 3], mask = [[1, 0, 2, 0], [0, 0, 0, 0], [1, 1, 1, 1]];
const values = Float32Array.from({ length: 36 }, (_, index) => Math.sin(index) * 100);
for (const token of [1, 3, 4, 5, 6, 7]) for (let column = 0; column < 3; column++) values[token * 3 + column] = NaN;
for (const normalize of [false, true]) {
  const expected = reference(values, shape, mask, normalize), stats = {};
  const actual = decodeOnnxEmbeddingOutput({ outputs: { last_hidden_state: { dims: shape, type: 'float32', data: values } },
    count: 3, attentionMask: mask, normalizeVector: normalize ? normalizeEmbeddingVectorInPlace : value => value, measurements: stats });
  assert.deepEqual(actual, expected, 'padding/nonbinary mask, zero-mask rows and normalization preserve scalar output');
  assert.equal(stats.hostPooledRows, 3); assert.equal(stats.outputValuesRead, 18);
  assert(stats.outputConversionWallMs >= 0); assert(stats.outputConversionProcessCpuMicros >= 0);
}
assert.deepEqual(decodeOnnxEmbeddingOutput({ outputs: null, count: 0, normalizeVector: value => value }), []);
for (const tensor of [
  { dims: [1, 2], type: 'int64', data: BigInt64Array.of(1n, 2n) },
  { dims: [1, 2], type: 'float32', data: Float32Array.of(1) },
  { dims: [1, 2], type: 'float32', data: Float32Array.of(1, Infinity) },
  { dims: [2, 1], type: 'float32', data: Float32Array.of(1, 2) }
]) assert.throws(() => decodeOnnxEmbeddingOutput({ outputs: { embeddings: tensor }, count: 1,
  normalizeVector: value => value }), { code: 'ERR_ONNX_EMBEDDING_OUTPUT' });
console.log('ONNX selective output and host pooling parity assertions complete');
