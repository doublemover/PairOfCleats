import assert from 'node:assert/strict';
import { createCacheOnlyEmbedder, hasCompleteCachedFileVectors, planStage3CacheOnly } from '../../../tools/build/embeddings/runner/cache-only.js';
import { buildCacheIdentity } from '../../../tools/build/embeddings/cache.js';
const items = [{ index: 9, chunk: { start: 0, end: 3 } }, { index: 3, chunk: { start: 8, end: 10, docmeta: { doc: 'documentation' } } }];
const cached = { codeVectors: [Uint8Array.of(1, 2), Uint8Array.of(3, 4)],
  docVectors: [new Uint8Array(0), Uint8Array.of(0, 0)], mergedVectors: [Uint8Array.of(0, 0), Uint8Array.of(5, 6)] };
assert.equal(hasCompleteCachedFileVectors({ cached, items, dims: 2 }), true, 'absent doc and present true-zero vectors preserve their separate meanings');
for (const edit of [value => { value.docVectors[1] = []; }, value => { value.codeVectors.pop(); },
  value => { value.mergedVectors[0] = [1]; }, value => { value.codeVectors[0] = [1, NaN]; },
  value => { value.docVectors[1] = [1, 256]; }]) {
  const candidate = structuredClone(cached); edit(candidate);
  assert.equal(hasCompleteCachedFileVectors({ cached: candidate, items, dims: 2 }), false);
}
const { identity, key } = buildCacheIdentity({ provider: 'onnx', modelId: 'fixture', dims: 2,
  modelArtifact: { status: 'verified', reuse: 'allow', digest: 'a'.repeat(64) } });
const abort = new AbortController(), runtime = createCacheOnlyEmbedder({ identity, signal: abort.signal });
assert.equal(runtime.executionInfo().loaded, false);
assert.equal(runtime.executionInfo().provider, null);
await assert.rejects(runtime.getChunkEmbeddings(['late miss']), { code: 'ERR_EMBEDDING_CACHE_ONLY_INVALIDATED' });
abort.abort();
await assert.rejects(runtime.getChunkEmbeddings(['late miss']), { name: 'AbortError' });
await runtime.dispose();
await assert.rejects(planStage3CacheOnly({ roots: [['code', 'unused']], identity, identityKey: key,
  signal: abort.signal }), { name: 'AbortError' });
const { inputFormatting: _formatting, ...missingFormatting } = identity;
for (const selected of [{ ...identity, dims: null }, { ...identity, modelArtifact: { status: 'unknown', reuse: 'refuse' } },
  missingFormatting]) {
  const plan = await planStage3CacheOnly({ roots: [], identity: selected, identityKey: key });
  assert.equal(plan.eligible, false, 'ambiguous identity never reaches cache IO or native construction');
}
console.log('cache-only exact channel coverage, invalidation and cancellation assertions complete');
