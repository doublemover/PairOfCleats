import { EMBEDDING_CHUNK_INPUT_VERSION } from '../../../src/shared/embedding-chunk-input.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCacheIdentity, resolveCacheMetaPath, resolveLegacyCacheDir, readCacheMeta, writeCacheMeta } from '../../../tools/build/embeddings/cache.js';
import { buildReferencedFileCache, hydrateReferencedFileCache } from '../../../tools/build/embeddings/cache/file-references.js';
import { buildOrReuseQuantizedChannels, hasReusableQuantizedChannels } from '../../../tools/build/embeddings/quantized-channels.js';
import { reusePriorChunkVectors } from '../../../tools/build/embeddings/prior-chunk-reuse.js';
import { resolveEmbeddingQuantizationSpec } from '../../../src/shared/embedding-quantization-spec.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('cache-profile-reference-admission');
const quantization = resolveEmbeddingQuantizationSpec({ minVal: -2, maxVal: 2, levels: 16 });
const a = buildCacheIdentity({ provider: 'stub', modelId: 'audit/model', dims: 2, stub: true, quantization });
const b = buildCacheIdentity({ ...a.identity, normalize: false });
await writeCacheMeta(dir, a.identity, 'code', { identityKey: b.key, marker: 'foreign-canonical' });
assert.equal(readCacheMeta(dir, a.identity, 'code'), null, 'a canonical directory is not identity evidence');
const legacyMeta = path.join(path.dirname(resolveLegacyCacheDir(dir, a.identity, 'code')), 'cache.meta.json');
await fs.mkdir(path.dirname(legacyMeta), { recursive: true });
await fs.writeFile(legacyMeta, JSON.stringify({ identityKey: a.key, marker: 'valid-legacy' }));
assert.equal(readCacheMeta(dir, a.identity, 'code').marker, 'valid-legacy');
await writeCacheMeta(dir, a.identity, 'code', { identityKey: a.key, marker: 'valid-canonical' });
assert.equal(readCacheMeta(dir, a.identity, 'code').marker, 'valid-canonical');
assert.notEqual(resolveCacheMetaPath(dir, a.identity, 'code'), resolveCacheMetaPath(dir, b.identity, 'code'));

const code = Uint8Array.of(9, 6), doc = new Uint8Array(0), merged = Uint8Array.of(9, 6);
const reused = { code, doc, merged };
assert.ok(hasReusableQuantizedChannels(reused, { quantization, dims: 2, hasDoc: false }));
assert.equal(hasReusableQuantizedChannels(reused, { quantization, dims: 2, hasDoc: true }), false);
assert.equal(hasReusableQuantizedChannels({ ...reused, doc: null }, { quantization }), false);
const assembled = buildOrReuseQuantizedChannels({ reused, codeVector: [], docVector: [], quantization });
assert.equal(assembled.quantizedCode, code); assert.equal(assembled.quantizedDoc, doc); assert.equal(assembled.quantizedMerged, merged);
assert.throws(() => buildOrReuseQuantizedChannels({ reused: { ...reused, code: Uint8Array.of(16, 2) }, quantization }), { code: 'ERR_EMBEDDING_CACHE_REUSE_INVALID' });
const prior = { cacheMeta: { chunkInputVersion: EMBEDDING_CHUNK_INPUT_VERSION, identityKey: a.key, identity: a.identity }, chunkHashes: ['first'],
  codeVectors: [code], docVectors: [doc], mergedVectors: [merged] };
const reuse = { code: [], doc: [], merged: [] };
assert.equal(reusePriorChunkVectors({ prior, chunkHashes: ['first'], docTexts: [''], identityKey: a.key, expectedDims: 2, reuse }), 1);
assert.equal(buildOrReuseQuantizedChannels({ reused: { code: reuse.code[0], doc: reuse.doc[0], merged: reuse.merged[0] },
  codeVector: [], docVector: [], quantization }).quantizedCode, code, 'changed-file reuse preserves code bytes beside an empty doc marker');

const vectors = { codeVectors: [code, code], docVectors: [doc, doc], mergedVectors: [merged, merged] };
const plan = buildReferencedFileCache({ identityKey: a.key, identity: a.identity, chunkHashes: ['first', 'first'], ...vectors,
  filePayload: { key: 'file', chunkHashes: ['first', 'first'], cacheMeta: { chunkInputVersion: EMBEDDING_CHUNK_INPUT_VERSION, identityKey: a.key, identity: a.identity } },
  buildInputKey: hash => hash });
assert.equal(plan.chunks.length, 1);
let reads = 0;
const readChunks = async keys => { reads++; assert.equal(keys.length, 1); return [{ entry: plan.chunks[0].payload }]; };
const hydrated = await hydrateReferencedFileCache({ entry: plan.filePayload, identityKey: a.key, readChunks });
assert.equal(reads, 1); assert.deepEqual(hydrated.docVectors.map(row => row.length), [0, 0]);
const corrupt = structuredClone(plan.filePayload);
corrupt.chunkReferences.records[0].channels.doc = 2;
await assert.doesNotReject(async () => {
  assert.equal(await hydrateReferencedFileCache({ entry: corrupt, identityKey: a.key,
    readChunks: () => { throw Error('conflicting duplicate references must be rejected before IO'); } }), null);
});
for (const result of [null, [], [{ entry: plan.chunks[0].payload }, { entry: plan.chunks[0].payload }]]) {
  assert.equal(await hydrateReferencedFileCache({ entry: plan.filePayload, identityKey: a.key, readChunks: async () => result }), null);
}
const cancelled = Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'ABORT_ERR' });
await assert.rejects(hydrateReferencedFileCache({ entry: plan.filePayload, identityKey: a.key,
  readChunks: async () => { throw cancelled; } }), error => error === cancelled);
assert.equal(buildReferencedFileCache({ identityKey: a.key, identity: a.identity, chunkHashes: ['first'], ...vectors,
  filePayload: null, buildInputKey: hash => hash }), null, 'producer cardinality mismatch cannot manufacture partial references');
console.log('Profile metadata and ordered chunk references retain exact identity, channel absence and bounded recovery admission.');
