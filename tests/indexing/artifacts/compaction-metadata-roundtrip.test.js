#!/usr/bin/env node
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';
import { getIndexDir } from '../../../src/shared/dict-utils.js';
import { buildShardedJsonlMetaFields } from '../../../src/index/build/artifacts/writers/_common.js';
import { checksumFile } from '../../../src/shared/hash.js';

const root = process.cwd();
const temp = resolveTestCachePath(root, 'compaction-metadata-roundtrip');
await fs.rm(temp, { recursive: true, force: true });
await fs.mkdir(temp, { recursive: true });
applyTestEnv({ testing: '1', cacheRoot: path.join(temp, 'cache') });
const repo = path.join(temp, 'repo');
await fs.mkdir(repo, { recursive: true });
const indexDir = getIndexDir(repo, 'code', {});
const save = async (name, data) => {
  const target = path.join(indexDir, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, typeof data === 'string' ? data : JSON.stringify(data));
};
const read = async (name) => JSON.parse(await fs.readFile(path.join(indexDir, name), 'utf8'));
const chunks = [{ id: 0, file: 'a.js', start: 0, end: 1 }, { id: 1, file: 'b.js', start: 1, end: 2 }];
const chunkParts = chunks.map((_, i) => `chunk_meta.parts/chunk_meta.part-${String(i).padStart(5, '0')}.jsonl`);
const tokenParts = chunks.map((_, i) => `token_postings.shards/token_postings.part-${String(i).padStart(5, '0')}.json`);
try {
  for (let i = 0; i < chunks.length; i += 1) {
    await save(chunkParts[i], `${JSON.stringify(chunks[i])}\n`);
    await save(tokenParts[i], { vocab: [['alpha', 'beta'][i]], vocabIds: [[101, 205][i]], postings: [[[i, 1]]] });
  }
  const chunkMeta = buildShardedJsonlMetaFields({
    artifact: 'chunk_meta',
    result: { total: 2 },
    parts: chunkParts.map((file) => ({ path: file, records: 1, bytes: 0 })),
    extensions: { caller: { semantic: true }, trim: { max: 10 }, offsets: { stale: true }, orderBuckets: { stale: true } }
  });
  await save('chunk_meta.meta.json', chunkMeta);
  await save('token_postings.meta.json', {
    format: 'sharded', shardSize: 1, vocabCount: 2, parts: tokenParts,
    totalDocs: 2, avgDocLen: 1, docLengths: [1, 1],
    extensions: { caller: { semantic: true }, tokenId: { algorithm: 'fixture' }, offsets: { stale: true } }
  });
  const allParts = [...chunkParts, ...tokenParts];
  await save('pieces/manifest.json', { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    version: 2, extensions: { rootCaller: 'retained' },
    pieces: [
      ...allParts.map((file) => ({
        type: file.startsWith('chunk') ? 'chunks' : 'postings',
        name: file.startsWith('chunk') ? 'chunk_meta' : 'token_postings',
        path: file, format: file.endsWith('jsonl') ? 'jsonl' : 'json',
        extensions: { caller: 'retained', offsets: { stale: true } }
      })),
      { name: 'chunk_meta_meta', path: 'chunk_meta.meta.json', extensions: { caller: 'meta-retained' } },
      { name: 'token_postings_meta', path: 'token_postings.meta.json', extensions: { caller: 'meta-retained' } },
      { name: 'chunk_meta_offsets', path: 'chunk_meta.parts/old.offsets.bin' },
      { name: 'unrelated', path: 'unrelated.json', extensions: { keep: true } }
    ]
  });
  runNode(['tools/index/compact-pieces.js', '--repo', repo, '--mode', 'code', '--chunk-meta-size', '2', '--token-postings-size', '2'], 'compact metadata round-trip', root, process.env, { timeoutMs: 20000 });
  const nextChunks = await read('chunk_meta.meta.json');
  const nextTokens = await read('token_postings.meta.json');
  assert.equal(nextChunks.extensions.__poc_generated.kind, 'sharded-meta');
  assert.equal(nextTokens.extensions.__poc_generated.kind, 'token-postings-meta');
  for (const meta of [nextChunks, nextTokens]) {
    assert.deepEqual(meta.extensions.caller, { semantic: true });
    assert.equal(meta.extensions.offsets, undefined);
    assert.equal(meta.extensions.orderBuckets, undefined);
    assert.equal(meta.parts.length, 1);
    assert.equal(Object.keys(meta)[0], 'extensions');
  }
  const rows = (await fs.readFile(path.join(indexDir, nextChunks.parts[0].path), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows, chunks, 'data rows remain data with no synthetic header');
  const tokens = await read(nextTokens.parts[0]);
  assert.deepEqual(tokens, { vocab: ['alpha', 'beta'], postings: [[[0, 1]], [[1, 1]]], vocabIds: [101, 205] });
  assert.deepEqual(nextTokens.extensions.tokenId, { algorithm: 'fixture' });
  const manifest = await read('pieces/manifest.json');
  assert.equal(manifest.extensions.__poc_generated.kind, 'pieces-manifest');
  assert.equal(manifest.extensions.rootCaller, 'retained');
  assert.ok(!manifest.pieces.some((piece) => piece.name === 'chunk_meta_offsets'));
  for (const piece of manifest.pieces.filter((entry) => entry.name !== 'unrelated')) {
    assert.ok(piece.extensions.caller);
    assert.equal(piece.extensions.offsets, undefined);
    const file = path.join(indexDir, piece.path);
    const checksum = await checksumFile(file);
    assert.equal(piece.bytes, (await fs.stat(file)).size);
    assert.equal(piece.checksum, `${checksum.algo}:${checksum.value}`);
  }
  assert.deepEqual(manifest.pieces.find((piece) => piece.name === 'unrelated').extensions, { keep: true });
  console.log('compaction metadata and token identity round-trip test passed');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
