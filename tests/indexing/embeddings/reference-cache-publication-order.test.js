import assert from 'node:assert/strict';
import path from 'node:path';
import { buildReferencedFileCache, createReferenceCacheWriter } from '../../../tools/build/embeddings/cache/file-references.js';
import { createCacheIndex, mergeCacheIndex } from '../../../tools/build/embeddings/cache/index-state.js';
import { upsertCacheIndexEntry } from '../../../tools/build/embeddings/cache.js';
const globalDir = path.resolve('.tmp/tasks/reference-publication-fixture/global-chunks');
const fileDir = path.join(path.dirname(globalDir), 'code', 'files');
const identityKey = 'identity', globalIndex = createCacheIndex(identityKey), fileIndex = createCacheIndex(identityKey), events = [];
const plan = buildReferencedFileCache({ identityKey, identity: { dims: 2 }, chunkHashes: ['input'], codeVectors: [[1, 2]], docVectors: [[]], mergedVectors: [[3, 4]],
  filePayload: { key: 'file', file: 'a.js', chunkHashes: ['input'], cacheMeta: { identityKey } }, buildInputKey: () => 'global-input' });
const failure = new Error('controlled file-index interruption');
const write = createReferenceCacheWriter({ lock: async (_dir, run) => run(), readIndex: async () => createCacheIndex(identityKey),
  readEntries: async (_dir, keys) => keys.map(() => ({ entry: null })),
  merge: mergeCacheIndex, upsert: upsertCacheIndexEntry,
  append: async (_dir, _index, bytes) => { events.push('chunk-append'); return { shard: 'shard-00000.bin', offset: 4, length: bytes.length, sizeBytes: bytes.length + 4 }; },
  writeIndex: async (_dir, index) => { events.push('chunk-index'); assert.ok(index.entries[plan.chunks[0].cacheKey]); },
  writeFiles: async () => { events.push('file-index'); throw failure; } });
await assert.rejects(write({ globalDir, globalIndex, fileDir, fileIndex, mode: 'code', filePayload: plan.filePayload,
  encodedFile: Buffer.from('file'), chunks: plan.chunks.map(chunk => ({ ...chunk, encodedPayload: Buffer.from('chunk') })) }), error => error === failure);
assert.deepEqual(events, ['chunk-append', 'chunk-index', 'file-index']);
assert.equal(Object.keys(fileIndex.entries).length, 0, 'interrupted publication never admits a dangling file reference');
assert.equal(Object.keys(globalIndex.entries).length, 1, 'complete chunk bytes may remain as reclaimable unreferenced content');
await assert.rejects(write({ globalDir, globalIndex, fileDir: path.dirname(globalDir), fileIndex, mode: 'code',
  filePayload: plan.filePayload, chunks: [] }), /escaped its profile/);
console.log('shared chunk publication precedes dependent file-index admission');
