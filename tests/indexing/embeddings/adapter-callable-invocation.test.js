import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getEmbeddingAdapter, __setTransformersModuleLoaderForTests,
  __setAdapterFactoryForTests, disposeEmbeddingAdapterCaches
} from '../../../src/shared/embedding-adapter.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('adapter-callable-invocation/')[1];
assert.ok(['pipeline-absent', 'pipeline-inert', 'pipeline-poisoned', 'adapter-methods'].includes(selected));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const contains = (error, original) => error === original || Boolean(error && typeof error === 'object'
  && (contains(error.cause, original) || error instanceof AggregateError && error.errors.some(value => contains(value, original))));
let applyReads = 0;
const decorateApply = (fn, mode) => {
  if (mode === 'inert') Object.defineProperty(fn, 'apply', { value: null });
  if (mode === 'poisoned') Object.defineProperty(fn, 'apply', { get() {
    applyReads++; throw new Error('callable .apply must never be consulted');
  } });
  return fn;
};
const callableMethod = (fn, mode) => decorateApply(Object.setPrototypeOf(fn, null), mode);

// Transformers.js Callable constructs a real closure, then replaces its
// Function prototype with the class prototype. It is callable without .apply.
class UpstreamCallable {
  constructor(body) {
    const closure = function (...args) { return closure._call(...args); };
    Object.setPrototypeOf(closure, new.target.prototype);
    closure._call = body;
    return closure;
  }
}

const { dir } = await prepareIsolatedTestCacheDir(`adapter-callable-${selected}`);
let adapter;
const workGate = deferred(), workEntered = deferred(), closeGate = deferred(), closeEntered = deferred();
try {
  if (selected.startsWith('pipeline-')) {
    const mode = selected.slice('pipeline-'.length), modelId = 'fixture/callable';
    const modelRoot = path.join(dir, modelId);
    await fs.mkdir(path.join(modelRoot, 'onnx'), { recursive: true });
    await fs.writeFile(path.join(modelRoot, 'onnx/model_quantized.onnx'), 'controlled local weights');
    await fs.writeFile(path.join(modelRoot, 'tokenizer.json'), '{}');
    let raw, closed = false, closeCalls = 0, replacementCalls = 0;
    const failure = Object.freeze(new Error('original callable inference rejection'));
    const cleanupFailure = Object.freeze(new Error('original callable cleanup rejection'));
    __setTransformersModuleLoaderForTests(async () => ({ env: {}, pipeline: async () => {
      raw = decorateApply(new UpstreamCallable(async function (texts) {
        assert.equal(this, raw, 'invoke the original upstream receiver');
        assert.equal(closed, false);
        if (texts.includes('reject')) throw failure;
        if (texts.includes('held')) { workEntered.resolve(); await workGate.promise; }
        assert.equal(closed, false, 'accepted inference retains the original pipeline');
        return texts.map(() => Float32Array.of(1, 2));
      }), mode);
      raw.prepare = callableMethod(function (texts, options) {
        assert.equal(this, raw);
        return { texts, options };
      }, mode);
      raw.executionInfo = callableMethod(function () {
        assert.equal(this, raw);
        return { fixtureCallable: true };
      }, mode);
      raw.dispose = async function () {
        assert.equal(this, raw, 'retain original disposal receiver');
        closeCalls++;
        if (closeCalls === 1) { closeEntered.resolve(); await closeGate.promise; throw cleanupFailure; }
        closed = true;
      };
      return raw;
    } }));
    adapter = getEmbeddingAdapter({ provider: 'xenova', modelId, modelsDir: dir, normalize: false });
    assert.deepEqual(await adapter.embed(['clean']), [Float32Array.of(1, 2)]);
    const lease = await adapter.embedderPromise;
    assert.equal(typeof raw, 'function');
    assert.equal(Function.prototype.isPrototypeOf(raw), false);
    assert.deepEqual(lease.executionInfo(), { fixtureCallable: true });
    assert.equal(adapter.executionInfo().fixtureCallable, true);
    const texts = ['snapshot'], options = { texts: ['option snapshot'] };
    const prepared = lease.prepare(texts, options);
    texts[0] = 'mutated'; options.texts[0] = 'mutated';
    assert.deepEqual(await prepared, { texts: ['snapshot'], options: { texts: ['option snapshot'] } });
    await assert.rejects(lease(['reject']), error => error === failure, 'preserve the exact inference rejection');
    const work = adapter.embed(['held']);
    await workEntered.promise;
    // The cache must retain its originally captured disposer, even if the
    // upstream public property changes after acquisition.
    raw.dispose = async () => { replacementCalls++; };
    let settled = false;
    const closing = adapter.dispose();
    closing.then(() => { settled = true; }, () => { settled = true; });
    const rejected = assert.rejects(closing, error => contains(error, cleanupFailure)
      && error.cacheOwnershipReleased() === false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false); assert.equal(closeCalls, 0);
    workGate.resolve();
    assert.deepEqual(await work, [Float32Array.of(1, 2)]);
    await closeEntered.promise;
    assert.equal(settled, false, 'held original cleanup cannot report a released lease');
    assert.equal(closeCalls, 1); assert.equal(replacementCalls, 0);
    closeGate.resolve(); await rejected;
    await adapter.dispose();
    assert.equal(closeCalls, 2, 'retry only the same originally captured disposer');
    assert.equal(closed, true); assert.equal(replacementCalls, 0);
    await assert.rejects(lease(['late']), /disposed/);
  } else {
    let raw, closed = false, closeCalls = 0;
    const failure = Object.freeze(new Error('original adapter method rejection'));
    __setAdapterFactoryForTests(() => {
      raw = {
        provider: 'onnx',
        embed: callableMethod(function (texts, options) {
          assert.equal(this, raw); assert.equal(closed, false);
          if (texts.includes('reject')) throw failure;
          return { texts, options };
        }, 'poisoned'),
        executionInfo: callableMethod(function () {
          assert.equal(this, raw); return { fixtureCallable: true };
        }, 'inert'),
        describe: callableMethod(function (value) { assert.equal(this, raw); return value; }, 'absent'),
        dispose: async function () { assert.equal(this, raw); closeCalls++; closed = true; }
      };
      return raw;
    });
    adapter = getEmbeddingAdapter({ provider: 'onnx', modelId: 'callable-stub', useStub: true, dims: 2 });
    const texts = ['snapshot'], options = { texts: ['option snapshot'] };
    const work = adapter.embed(texts, options);
    texts[0] = 'mutated'; options.texts[0] = 'mutated';
    assert.deepEqual(await work, { texts: ['snapshot'], options: { texts: ['option snapshot'] } });
    assert.deepEqual(adapter.executionInfo(), { fixtureCallable: true });
    assert.equal(adapter.describe('ordinary observation'), 'ordinary observation');
    await assert.rejects(adapter.embed(['reject']), error => error === failure);
    await adapter.dispose(); await adapter.dispose();
    assert.equal(closeCalls, 1); assert.equal(closed, true);
    await assert.rejects(adapter.embed(['late']), /disposed/);
  }
  assert.equal(applyReads, 0, 'no invocation reads an upstream .apply property');
} finally {
  workGate.resolve(); closeGate.resolve();
  try { await adapter?.dispose(); await disposeEmbeddingAdapterCaches(); }
  finally {
    __setTransformersModuleLoaderForTests(null); __setAdapterFactoryForTests(null);
    await fs.rm(dir, { recursive: true, force: true });
  }
}
console.log(`Callable lease invocation preserves original work and cleanup: ${selected}.`);
