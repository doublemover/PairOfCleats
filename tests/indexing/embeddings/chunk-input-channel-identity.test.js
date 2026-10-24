import assert from 'node:assert/strict';
import { buildEmbeddingChunkInputHash as inputHash, EMBEDDING_CHUNK_INPUT_VERSION } from '../../../src/shared/embedding-chunk-input.js';
import { reusePriorChunkVectors } from '../../../tools/build/embeddings/prior-chunk-reuse.js';
import { buildCacheIdentity, buildGlobalChunkCacheKey, resolveGlobalChunkCacheDir, writeCacheEntry,
  readCacheEntry, isGlobalChunkCacheValid, isCacheValid } from '../../../tools/build/embeddings/cache.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const a = { codeText: 'alpha\nbeta', docText: 'gamma' };
const b = { codeText: 'alpha', docText: 'beta\ngamma' };
assert.equal(`${a.codeText}\n${a.docText}`, `${b.codeText}\n${b.docText}`, 'original delimiter witness');
const aHash = inputHash(a), bHash = inputHash(b);
assert.notEqual(aHash, bHash);
assert.equal(inputHash({ ...a }), aHash);
assert.notEqual(inputHash({ codeText: '', docText: null }), inputHash({ codeText: '', docText: '' }));
assert.notEqual(inputHash({ codeText: 'a\r\nb' }), inputHash({ codeText: 'a\nb' }));
assert.notEqual(inputHash({ codeText: '😀\0documentation:2:x', docText: 'é' }),
  inputHash({ codeText: '😀', docText: '\0documentation:2:xé' }));
const { identity, key: identityKey } = buildCacheIdentity({ provider: 'onnx', modelId: 'synthetic-inputs', dims: 2, stub: true });
const prior = { chunkSignature: 'signature', hash: 'file', chunkHashes: [aHash],
  cacheMeta: { identityKey, identity, chunkInputVersion: EMBEDDING_CHUNK_INPUT_VERSION },
  codeVectors: [Uint8Array.of(1, 2)], docVectors: [Uint8Array.of(3, 4)], mergedVectors: [Uint8Array.of(5, 6)] };
const reuse = hashes => {
  const target = { code: hashes.map(() => null), doc: hashes.map(() => null), merged: hashes.map(() => null) };
  return { target, count: reusePriorChunkVectors({ prior, chunkHashes: hashes, docTexts: hashes.map(() => 'present'),
    identityKey, expectedDims: 2, reuse: target }) };
};
assert.equal(reuse([bHash]).count, 0, 'moving content between channels cannot borrow prior vectors');
const exact = reuse([bHash, aHash, aHash]);
assert.equal(exact.count, 1, 'original ordinal multiplicity remains bounded');
assert.equal(exact.target.code[1], prior.codeVectors[0]);
assert.equal(exact.target.doc[1], prior.docVectors[0]);
const root = await makeTempDir('embedding-channel-input-');
try {
  const dir = resolveGlobalChunkCacheDir(root, identity);
  const keyA = buildGlobalChunkCacheKey({ identityKey, chunkHash: aHash });
  const keyB = buildGlobalChunkCacheKey({ identityKey, chunkHash: bHash });
  assert.notEqual(keyA, keyB);
  await writeCacheEntry(dir, keyA, { ...prior, key: keyA, hash: aHash });
  const cached = (await readCacheEntry(dir, keyA)).entry;
  assert.equal(isGlobalChunkCacheValid({ cached, identityKey, chunkHash: aHash }), true);
  assert.equal((await readCacheEntry(dir, keyB)).entry, null, 'persistent global lookup cannot substitute A for B');
  assert.deepEqual([...cached.docVectors[0]], [3, 4]);
  const legacy = { ...prior, cacheMeta: { identityKey, identity } };
  assert.equal(isCacheValid({ cached: legacy, signature: 'signature', identityKey, hash: 'file' }), false);
  assert.equal(isGlobalChunkCacheValid({ cached: { ...legacy, hash: aHash }, identityKey, chunkHash: aHash }), false);
  assert.equal(reusePriorChunkVectors({ prior: legacy, chunkHashes: [aHash], docTexts: ['present'], identityKey,
    expectedDims: 2, reuse: { code: [], doc: [], merged: [] } }), 0, 'legacy metadata cannot be relabelled');
} finally { await rmDirRecursive(root); }
console.log('Exact framed channels separate prior and persistent global reuse without losing identical-input hits.');
