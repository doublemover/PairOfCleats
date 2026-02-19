#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadChunkMeta, loadJsonObjectArtifact } from '../../../src/shared/artifact-io.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const cacheRoot = await prepareArtifactIoTestDir('artifact-io-manifest-discovery', { root });

const indexDir = path.join(cacheRoot, 'index');
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
await fs.writeFile(
  path.join(indexDir, 'chunk_meta.json'),
  JSON.stringify([{ id: 0, file: 'alpha.js', start: 0, end: 1 }])
);
await fs.writeFile(
  path.join(indexDir, 'dense_vectors_uint8.json'),
  JSON.stringify({ model: null, dims: 1, scale: 1, vectors: [] })
);
await fs.writeFile(
  path.join(indexDir, 'dense_vectors_hnsw.meta.json'),
  JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    model: null,
    dims: 1,
    count: 0,
    space: 'cosine',
    m: 16,
    efConstruction: 200,
    efSearch: 64
  })
);

let err = null;
try {
  await loadChunkMeta(indexDir);
} catch (next) {
  err = next;
}
assert.ok(err, 'expected missing manifest to throw');

err = null;
try {
  await loadJsonObjectArtifact(indexDir, 'dense_vectors');
} catch (next) {
  err = next;
}
assert.ok(err, 'expected missing manifest to throw for dense_vectors');

err = null;
try {
  await loadJsonObjectArtifact(indexDir, 'dense_vectors_hnsw_meta');
} catch (next) {
  err = next;
}
assert.ok(err, 'expected missing manifest to throw for dense_vectors_hnsw_meta');

await writePiecesManifest(indexDir, [], {
  compatibilityKey: `v${ARTIFACT_SURFACE_VERSION}-test`
});
err = null;
try {
  await loadChunkMeta(indexDir);
} catch (next) {
  err = next;
}
assert.ok(err, 'expected missing manifest entry to throw');
assert.ok(String(err.message).includes('Missing manifest entry'));

err = null;
try {
  await loadJsonObjectArtifact(indexDir, 'dense_vectors');
} catch (next) {
  err = next;
}
assert.ok(err, 'expected missing dense_vectors entry to throw');
assert.ok(String(err.message).includes('Missing manifest entry'));

err = null;
try {
  await loadJsonObjectArtifact(indexDir, 'dense_vectors_hnsw_meta');
} catch (next) {
  err = next;
}
assert.ok(err, 'expected missing dense_vectors_hnsw_meta entry to throw');
assert.ok(String(err.message).includes('Missing manifest entry'));

await writePiecesManifest(indexDir, [
  { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
  { name: 'dense_vectors', path: 'dense_vectors_uint8.json', format: 'json' },
  { name: 'dense_vectors_hnsw_meta', path: 'dense_vectors_hnsw.meta.json', format: 'json' }
], {
  compatibilityKey: `v${ARTIFACT_SURFACE_VERSION}-test`
});
const chunks = await loadChunkMeta(indexDir);
assert.equal(chunks.length, 1);
const dense = await loadJsonObjectArtifact(indexDir, 'dense_vectors');
if (!dense || !Array.isArray(dense.vectors)) {
  throw new Error('Expected dense_vectors to load from manifest.');
}
const hnswMeta = await loadJsonObjectArtifact(indexDir, 'dense_vectors_hnsw_meta');
if (!hnswMeta || !Number.isFinite(hnswMeta.dims)) {
  throw new Error('Expected dense_vectors_hnsw_meta to load from manifest.');
}

console.log('artifact-io manifest discovery test passed');

