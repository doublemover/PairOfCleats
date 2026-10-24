import { EMBEDDING_CHUNK_INPUT_VERSION } from '../../../src/shared/embedding-chunk-input.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCacheIdentity, buildGlobalChunkCacheKey, resolveCacheDir, resolveGlobalChunkCacheDir,
  readCacheIndex, writeCacheIndex, writeReferencedCacheFile, encodeCacheEntryPayload, flushCacheIndex } from '../../../tools/build/embeddings/cache.js';
import { buildReferencedFileCache } from '../../../tools/build/embeddings/cache/file-references.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('reference-cache-delta-retention');
try {
  const { identity, key: identityKey } = buildCacheIdentity({ provider: 'onnx', modelId: 'synthetic', dims: 2, stub: true });
  const fileDir = resolveCacheDir(dir, identity, 'code'), globalDir = resolveGlobalChunkCacheDir(dir, identity);
  await fs.mkdir(fileDir, { recursive: true }); await fs.mkdir(globalDir, { recursive: true });
  const fileIndex = await readCacheIndex(fileDir, identityKey), globalIndex = await readCacheIndex(globalDir, identityKey);
  await writeCacheIndex(fileDir, fileIndex);
  const plan = buildReferencedFileCache({ identity, identityKey, chunkHashes: ['content'], codeVectors: [[1, 2]], docVectors: [[]], mergedVectors: [[1, 2]],
    filePayload: { key: 'file', file: 'file.js', chunkHashes: ['content'], cacheMeta: { identityKey, chunkInputVersion: EMBEDDING_CHUNK_INPUT_VERSION } },
    buildInputKey: chunkHash => buildGlobalChunkCacheKey({ chunkHash, identityKey }) });
  await writeReferencedCacheFile({ fileDir, fileIndex, globalDir, globalIndex, mode: 'code', filePayload: plan.filePayload,
    encodedFile: await encodeCacheEntryPayload(plan.filePayload), chunks: await Promise.all(plan.chunks.map(async chunk => ({ ...chunk, encodedPayload: await encodeCacheEntryPayload(chunk.payload) }))) });
  assert.equal(Object.keys(JSON.parse(await fs.readFile(path.join(fileDir, 'cache.index.json'), 'utf8')).entries).length, 0,
    'dependent file ownership exists only in the admitted delta in this fixture');
  const result = await flushCacheIndex(globalDir, globalIndex, { maxBytes: 1 });
  assert.equal(Object.keys(globalIndex.entries).length, 1, 'reference-aware pruning reads the complete file index, including deltas');
  assert.equal(result.budgetExceeded, true);
  const filename = path.join(fileDir, 'cache.index.delta'), bytes = await fs.readFile(filename);
  bytes[bytes.length - 1] ^= 1; await fs.writeFile(filename, bytes);
  const blocked = await flushCacheIndex(globalDir, globalIndex, { maxBytes: 1 });
  assert.equal(blocked.blocked, 'reference-ownership-unreadable');
  assert.equal(Object.keys(globalIndex.entries).length, 1);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('File-index delta references remain retention authority and corrupt ownership blocks chunk cleanup.');
