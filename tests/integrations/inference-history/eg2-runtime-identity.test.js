import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveArchiveEmbeddingOptions, createArchiveEmbeddingRuntime } from '../../../src/integrations/inference-history/embedding-runtime.js';
import { __setAdapterFactoryForTests } from '../../../src/shared/embedding-adapter.js';

const base = { modelsDir: path.resolve('temp/tasks/eg2-runtime-identity-tests/models') };
const initial = resolveArchiveEmbeddingOptions(base);
for (const option of [{ task: 'code' }, { task: 'question-answering' }, { dimensions: 256 },
  { batchSize: 8 }, { maxCacheInputs: 10, maxCacheBytes: 4096 }, { sessionOptions: { intraOpNumThreads: 2, executionMode: 'sequential' } }]) {
  assert.equal(resolveArchiveEmbeddingOptions({ ...base, ...option }).documentIdentityKey,
    initial.documentIdentityKey, 'query/storage/scheduling do not change document computation');
}
assert.notEqual(resolveArchiveEmbeddingOptions({ ...base, task: 'code' }).queryIdentityKey,
  initial.queryIdentityKey);
assert.notEqual(resolveArchiveEmbeddingOptions({ ...base, dimensions: 256 }).representationIdentityKey,
  initial.representationIdentityKey);
for (const option of [{ dtype: 'q8' }, { revision: 'b'.repeat(40) },
  { tokenizerIdentity: 'different-tokenizer' }, { chunkChars: 1200 },
  { graphSha256: 'c'.repeat(64), numericalRecipe: 'cpu-w8a8-level4', modelFileName: 'model_w8a8' }]) {
  assert.notEqual(resolveArchiveEmbeddingOptions({ ...base, ...option }).documentIdentityKey,
    initial.documentIdentityKey, 'changed effective document computation cannot reuse old vectors');
}
assert.throws(() => resolveArchiveEmbeddingOptions({ ...base, numericalRecipe: 'cpu-w8a8-level4' }));
assert.throws(() => resolveArchiveEmbeddingOptions({ ...base, modelFileName: 'model_w8a8' }));
assert.throws(() => resolveArchiveEmbeddingOptions({ ...base, sessionOptions: { executionProviders: ['dml'] } }));
assert.throws(() => resolveArchiveEmbeddingOptions({ ...base, maxCacheInputs: 0 }));
assert.throws(() => resolveArchiveEmbeddingOptions({ ...base, maxCacheBytes: 3071 }));
assert.equal(initial.maxCacheInputs, 1000000);
assert.equal(initial.maxCacheBytes, 8589934592);
assert.equal(initial.fullDimensions, 768);
assert.equal(resolveArchiveEmbeddingOptions({ ...base, dimensions: 256 }).fullProfile.dimensions, 768);
let seen, release;
const full = new Float32Array(768); full[0] = 0.6; full[767] = 0.8;
__setAdapterFactoryForTests(options => {
  seen = options;
  return {
    prepare: async texts => texts.map(text => ({ tokenLength: text.length, text })),
    embedPrepared: async items => items.map(() => full),
    embed: async texts => texts.map(() => full),
    embedOne: async () => full,
    executionInfo: () => ({ requestedSessionOptions: options.sessionOptions })
  };
});
try {
  const runtime = createArchiveEmbeddingRuntime({ ...base, dimensions: 256,
    sessionOptions: { intraOpNumThreads: 2 } });
  assert.equal(seen.modelProfile.dimensions, 768);
  assert.equal(seen.sessionOptions.intraOpNumThreads, 2);
  const text = 'x\n\u{1f680}e\u0301';
  const prepared = await runtime.prepareBatch([text]);
  assert.equal(prepared[0].text, 'title: none | text: ' + text);
  assert.equal((await runtime.encodePrepared(prepared))[0].length, 768);
  assert.equal((await runtime.encodeBatch([text]))[0].length, 768);
  const query = await runtime.encodeQuery('question');
  assert.equal(query.length, 256);
  assert.equal(query[0], 1, 'truncate then renormalize');
  assert.equal(runtime.executionInfo().cpuOnly, true);
  __setAdapterFactoryForTests(() => ({
    embed: () => new Promise(resolve => { release = resolve; })
  }));
  const pendingRuntime = createArchiveEmbeddingRuntime(base);
  const cancelled = new AbortController();
  const pending = pendingRuntime.encodeBatch(['pending'], { signal: cancelled.signal });
  await Promise.resolve();
  cancelled.abort();
  await assert.rejects(pendingRuntime.encodeBatch(['overlap']), { code: 'ERR_INFERENCE_HISTORY_LIMIT' });
  assert.equal(pendingRuntime.executionInfo().activeNativeCalls, 1);
  release([full]);
  await assert.rejects(pending, { name: 'AbortError' });
  await pendingRuntime.waitForIdle();
  assert.equal(pendingRuntime.executionInfo().activeNativeCalls, 0);
} finally { __setAdapterFactoryForTests(null); }
console.log('archive EG2 separated identities and runtime admission passed (mock encoder)');
