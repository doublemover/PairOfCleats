import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveArchiveEmbeddingOptions, createArchiveEmbeddingRuntime, __setArchiveWorkerFactoryForTests } from '../../../src/integrations/inference-history/embedding-runtime.js';

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
let seen;
__setArchiveWorkerFactoryForTests(config=>{seen=config;return{config,executionInfo:()=>({loaded:false,cpuOnly:true,documentIdentityKey:config.documentIdentityKey})};});
try {
  const runtime=createArchiveEmbeddingRuntime({...base,dimensions:256,sessionOptions:{intraOpNumThreads:2}});
  assert.equal(seen.fullProfile.dimensions,768);
  assert.equal(seen.profile.dimensions,256);
  assert.equal(seen.sessionOptions.intraOpNumThreads,2);
  assert.equal(seen.passagePrefix,'title: {context} | text: ');
  assert.equal(runtime.executionInfo().loaded,false);
  assert.equal(runtime.executionInfo().documentIdentityKey,initial.documentIdentityKey);
} finally {__setArchiveWorkerFactoryForTests(null);}
console.log('archive EG2 separated identities and worker configuration passed (mock transport)');

