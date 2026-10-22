import assert from 'node:assert/strict';
import { createPreparedTextEncoder } from '../../src/shared/embedding-prepared.js';
import { createRunQueue } from '../../src/shared/onnx-embeddings/run-queue.js';
import { __setTransformersModuleLoaderForTests, disposeEmbeddingAdapterCaches, getEmbeddingAdapter } from '../../src/shared/embedding-adapter.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
class Tensor { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } }
const tokenizer = async (texts, options) => {
  const rows = texts.map(text => [text.codePointAt(0)]);
  if (options.return_tensor === false) return { input_ids: rows, attention_mask: rows.map(() => [1]) };
  return { input_ids: new Tensor('int64', BigInt64Array.from(rows.flat(), BigInt), [texts.length, 1]) };
};
let active = 0, peak = 0, loads = 0, disposals = 0;
let hold = null;
let entered = null;
const model = async input => {
  active += 1;
  peak = Math.max(peak, active);
  entered?.resolve();
  try {
    if (hold) await hold.promise;
    const count = input.input_ids.dims[0];
    const data = new Float32Array(count * 768);
    for (let row = 0; row < count; row++) {
      data[row * 768] = Number(input.input_ids.data[row]);
      data[row * 768 + 1] = 1;
    }
    return { sentence_embedding: { dims: [count, 768], data } };
  } finally { active -= 1; }
};
model.dispose = async () => { disposals += 1; };
__setTransformersModuleLoaderForTests(async () => ({
  Tensor, env: { version: '4.3.1' }, EmbeddingGemma2Model: class {},
  AutoConfig: { from_pretrained: async () => ({ model_type: 'embedding_gemma2' }) },
  AutoTokenizer: { from_pretrained: async () => tokenizer },
  AutoModel: { from_pretrained: async () => { loads += 1; return model; } }
}));
const config = { modelId: 'onnx-community/embeddinggemma-2-ONNX', provider: 'xenova', retainInCache: true };
const first = getEmbeddingAdapter(config), second = getEmbeddingAdapter(config);
try {
  const prepared = await first.prepare(['c']);
  hold = deferred(); entered = deferred();
  const a = first.embedOne('a');
  await entered.promise;
  const b = second.embedOne('b');
  const c = second.embedPrepared(prepared);
  const cancelled = new AbortController();
  const aborted = second.embedOne('d', { signal: cancelled.signal });
  const cancelledResult = assert.rejects(aborted, { name: 'AbortError' });
  cancelled.abort();
  await cancelledResult;
  hold.resolve(); hold = null;
  const [av, bv, cv] = await Promise.all([a, b, c]);
  assert.equal(av.length, 768); assert.equal(bv.length, 768); assert.equal(cv[0].length, 768);
  assert.ok(av[0] < bv[0] && bv[0] < cv[0][0], 'each distinct request retains its own input/output');
  assert.equal(loads, 1); assert.equal(peak, 1);
  await first.dispose(); await second.dispose();
  const warm = getEmbeddingAdapter(config);
  await warm.embedOne('e');
  assert.equal(loads, 1, 'ordinary contention and cancellation retain the healthy warm adapter');
  await warm.dispose();
} finally {
  hold?.resolve();
  await Promise.allSettled([first.dispose(), second.dispose()]);
  await disposeEmbeddingAdapterCaches();
  __setTransformersModuleLoaderForTests(null);
}

const queue = createRunQueue({ maxQueued: 1 });
const gate = deferred(), started = deferred();
const running = queue(async () => { started.resolve(); await gate.promise; return 'running'; });
await started.promise;
const waiting = queue(() => 'waiting');
await assert.rejects(queue(() => 'overflow'), { code: 'ERR_EMBEDDING_QUEUE_FULL' });
const waitingResult = assert.rejects(waiting, { code: 'ERR_EMBEDDING_QUEUE_CLOSED' });
let drained = false;
const closing = queue.close().then(() => { drained = true; });
await waitingResult;
assert.equal(drained, false);
gate.resolve();
assert.equal(await running, 'running');
await closing;
await assert.rejects(queue(() => 'late'), { code: 'ERR_EMBEDDING_QUEUE_CLOSED' });

const encoder = createPreparedTextEncoder({ tokenizer, model, Tensor,
  profile: { maxLength: 8192, dimensions: 768 }, sessionOptions: {} });
hold = deferred(); entered = deferred();
const inFlight = encoder(['x']);
await entered.promise;
const queued = encoder(['y']);
const queuedResult = assert.rejects(queued, { code: 'ERR_EMBEDDING_QUEUE_CLOSED' });
const beforeDispose = disposals;
const disposing = encoder.dispose();
await queuedResult;
assert.equal(disposals, beforeDispose, 'disposal cannot destroy active native work');
hold.resolve(); hold = null;
await inFlight;
await disposing;
await encoder.dispose();
assert.equal(disposals, beforeDispose + 1);
console.log('embedding shared admission test passed');
