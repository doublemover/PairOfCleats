import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCacheIdentity, buildGlobalChunkCacheKey, resolveCacheDir, resolveGlobalChunkCacheDir,
  readCacheEntries, writeCacheIndex, writeReferencedCacheFile, encodeCacheEntryPayload, flushCacheIndex } from '../../../tools/build/embeddings/cache.js';
import { createCacheIndex } from '../../../tools/build/embeddings/cache/index-state.js';
import { buildReferencedFileCache, hydrateReferencedFileCache } from '../../../tools/build/embeddings/cache/file-references.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const { dir } = await prepareIsolatedTestCacheDir('file-reference-cache-roundtrip');
const { identity, key: identityKey } = buildCacheIdentity({ provider: 'onnx', modelId: 'synthetic', dims: 2, stub: true });
const fileDir = resolveCacheDir(dir, identity, 'code'), globalDir = resolveGlobalChunkCacheDir(dir, identity);
await fs.mkdir(fileDir, { recursive: true }); await fs.mkdir(globalDir, { recursive: true });
const fileIndex = createCacheIndex(identityKey), globalIndex = createCacheIndex(identityKey);
const vectors = { codeVectors: [Uint8Array.of(1, 2), Uint8Array.of(3, 4), Uint8Array.of(1, 2)],
  docVectors: [[], Uint8Array.of(4, 3), []], mergedVectors: [Uint8Array.of(5, 6), Uint8Array.of(7, 8), Uint8Array.of(5, 6)] };
const plan = file => buildReferencedFileCache({ identity, identityKey, ...vectors, chunkHashes: ['a', 'b', 'a'],
  filePayload: { key: file, file: `${file}.js`, hash: 'source', chunkSignature: 'signature', chunkHashes: ['a', 'b', 'a'], cacheMeta: { identityKey } },
  buildInputKey: chunkHash => buildGlobalChunkCacheKey({ chunkHash, identityKey, pathPolicy: 'posix' }) });
const persist = async value => writeReferencedCacheFile({ fileDir, fileIndex, globalDir, globalIndex, mode: 'code', filePayload: value.filePayload,
  encodedFile: await encodeCacheEntryPayload(value.filePayload), chunks: await Promise.all(value.chunks.map(async chunk => ({ ...chunk,
    encodedPayload: await encodeCacheEntryPayload(chunk.payload) }))) });
const first = plan('file-a'); assert.equal(first.chunks.length, 2); assert.equal(first.filePayload.codeVectors.length, 0);
assert.equal((await persist(first)).storedChunks, 2);
const shardBytes = async () => (await Promise.all((await fs.readdir(path.join(globalDir, 'shards'))).map(name => fs.stat(path.join(globalDir, 'shards', name))))).reduce((sum, stat) => sum + stat.size, 0);
const before = await shardBytes();
assert.equal((await persist(plan('file-b'))).storedChunks, 0);
assert.equal(await shardBytes(), before, 'duplicate files do not append a second quantized chunk payload');
const [row] = await readCacheEntries(fileDir, ['file-a'], fileIndex);
const hydrated = await hydrateReferencedFileCache({ entry: row.entry, identityKey,
  readChunks: keys => readCacheEntries(globalDir, keys, globalIndex) });
for (const channel of ['codeVectors', 'docVectors', 'mergedVectors']) assert.deepEqual(hydrated[channel].map(vector => Array.from(vector)), vectors[channel].map(vector => Array.from(vector)));
assert.equal(await hydrateReferencedFileCache({ entry: row.entry, identityKey: 'foreign', readChunks: () => { throw Error('must not read foreign chunks'); } }), null);
assert.equal(await hydrateReferencedFileCache({ entry: row.entry, identityKey, readChunks: keys => keys.map(() => ({ entry: null })) }), null);
const inputKey = first.chunks[0].inputKey;
assert.equal((await readCacheEntries(globalDir, [inputKey], globalIndex))[0].entry.key, first.chunks[0].cacheKey, 'input aliases resolve the immutable content row');
const retained = await flushCacheIndex(globalDir, globalIndex, { maxBytes: 1 });
assert.equal(Object.keys(globalIndex.entries).length, 2); assert.equal(retained.budgetExceeded, true);
await fs.writeFile(path.join(fileDir, 'cache.index.json'), '{broken');
const blocked = await flushCacheIndex(globalDir, globalIndex, { maxBytes: 1 });
assert.equal(blocked.blocked, 'reference-ownership-unreadable'); assert.equal(Object.keys(globalIndex.entries).length, 2);
await writeCacheIndex(fileDir, fileIndex);
await flushCacheIndex(fileDir, fileIndex, { maxBytes: 1 });
assert.equal(Object.keys(fileIndex.entries).length, 0);
await flushCacheIndex(globalDir, globalIndex, { maxBytes: 1 });
assert.equal(Object.keys(globalIndex.entries).length, 0, 'retiring every file releases chunk retention without stale reference resurrection');
console.log('ordered shared chunk references preserve vectors and reference-aware pruning');
