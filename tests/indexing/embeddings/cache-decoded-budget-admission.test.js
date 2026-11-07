import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { zstdCompress, zstdDecompress } from 'node:zlib';
import { decodeEmbeddingsCache, encodeEmbeddingsCache } from '../../../src/shared/embeddings-cache/index.js';
import { buildCacheIdentity, resolveCacheDir, readCacheIndex, readCacheEntries, writeCacheEntries } from '../../../tools/build/embeddings/cache.js';
import { createCacheIndex } from '../../../tools/build/embeddings/cache/index-state.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('embedding-cache-decoded-admission');
const { identity, key } = buildCacheIdentity({ provider: 'stub', modelId: 'bounded', dims: 2048, stub: true });
const row = new Uint8Array(2048).fill(7);
const payload = { key: 'row', cacheMeta: { identityKey: key, identity }, codeVectors: [row], docVectors: [[]], mergedVectors: [row] };
const encoded = await encodeEmbeddingsCache(payload);
assert.equal((await decodeEmbeddingsCache(encoded)).codeVectors[0].length, row.length);
await assert.rejects(decodeEmbeddingsCache(encoded, { maxBytes: 1024 }), 'compressed size cannot authorize an oversized decoded entry');
const raw = await promisify(zstdDecompress)(encoded);
const trailing = await promisify(zstdCompress)(Buffer.concat([raw, Buffer.of(0)]));
await assert.rejects(decodeEmbeddingsCache(trailing), /trailing bytes/);
await assert.rejects(encodeEmbeddingsCache({ codeVectors: new Array(32769) }), /row count/);

const directory = resolveCacheDir(dir, identity, 'code');
assert.equal((await writeCacheEntries(directory, createCacheIndex(key), [{ cacheKey: payload.key, payload, encodedPayload: encoded }])).length, 1);
const index = await readCacheIndex(directory, key);
assert.equal((await readCacheEntries(directory, ['row'], index, { maxReadBytes: 1024 }))[0].entry, null,
  'the actual shard reader applies the decoded allowance before row admission');
assert.equal((await readCacheEntries(directory, ['row'], index))[0].entry.codeVectors[0].length, row.length);
await assert.rejects(readCacheEntries(directory, ['row'], index, { maxReadBytes: 1024, maxEntryBytes: 2048 }), /reservation/);
console.log('Cache codec and real shard consumer retain bounded decoded bytes and canonical framing.');
