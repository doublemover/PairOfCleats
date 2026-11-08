#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeDenseVectorArtifacts } from '../../../src/shared/dense-vector-artifacts.js';
import { buildEmbeddingIdentity } from '../../../src/shared/embedding-identity.js';
import { checksumFile } from '../../../src/shared/hash.js';
import { resolveVectorsSource } from '../../../tools/build/embeddings/vector-source.js';
import { prepareArtifactIoTestDir, writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

const root = await prepareArtifactIoTestDir('binary-vector-source-stream');
try {
  const base = 'dense_vectors_doc_uint8', generation = '7'.repeat(64);
  const identity = buildEmbeddingIdentity({ provider: 'stub', stub: true, dims: 3, modelId: 'fixture' });
  const vectors = [new Uint8Array([1, 2, 3]), [], new Uint8Array([0, 0, 0]), new Uint8Array([9, 8, 7])];
  await writeDenseVectorArtifacts({ indexDir: root, baseName: base, vectors, writeBinary: true,
    vectorFields: { dims: 3, model: 'fixture', embeddingIdentity: identity, embeddingGeneration: generation } });
  const pieces = [];
  for (const [name, suffix, format] of [['dense_vectors_doc', '.bin', 'bin'], ['dense_vectors_doc_binary_meta', '.bin.meta.json', 'json']]) {
    const file = path.join(root, base + suffix), digest = await checksumFile(file);
    pieces.push({ name, path: base + suffix, format, bytes: (await fs.stat(file)).size, count: vectors.length, dims: 3,
      checksum: `${digest.algo}:${digest.value}` });
  }
  await writePiecesManifest(root, pieces);
  const options = { requireManifestDeclaration: true, expectedDims: 3, expectedModelId: 'fixture',
    expectedEmbeddingIdentity: identity, expectedEmbeddingGeneration: generation };
  const textual = resolveVectorsSource(path.join(root, base), { ...options, preferBinary: false });
  const textRows = [];
  for await (const row of textual.rows) textRows.push(Array.from(row.vector || row.values || []));
  const source = resolveVectorsSource(path.join(root, base), options);
  assert.equal(source.format, 'uint8-row-major');
  assert.equal(source.vectors, null, 'binary handoff does not hydrate a resident corpus');
  await fs.rm(path.join(root, `${base}.parts`), { recursive: true });
  const binaryRows = [];
  for await (const row of source.rows) binaryRows.push([row.docId, Array.from(row.vector)]);
  assert.deepEqual(binaryRows, [[0, [1, 2, 3]], [1, []], [2, [0, 0, 0]], [3, [9, 8, 7]]]);
  assert.deepEqual(binaryRows.map(row => row[1]), textRows, 'absent rows and legitimate zero vectors agree across representations');
  assert.throws(() => resolveVectorsSource(path.join(root, base), { ...options, expectedEmbeddingGeneration: '8'.repeat(64) }),
    { code: 'ERR_DENSE_VECTOR_SOURCE_IDENTITY' });
  assert.throws(() => resolveVectorsSource(path.join(root, base), { ...options, expectedDims: 4 }),
    { code: 'ERR_DENSE_VECTOR_SOURCE_IDENTITY' });

  const primaryPath = path.join(root, `${base}.meta.json`);
  const primaryBytes = await fs.readFile(primaryPath);
  const primary = JSON.parse(primaryBytes);
  for (const change of [{ format: 'uint8-row-major' }, { format: 'unrecognized' },
    { dims: 4 }, { embeddingGeneration: '8'.repeat(64) },
    { validity: { ...primary.validity, validCount: 4, bits: 'Dw==' } }]) {
    await fs.writeFile(primaryPath, JSON.stringify({ ...primary, ...change }));
    assert.throws(() => resolveVectorsSource(path.join(root, base), options),
      { code: 'ERR_DENSE_VECTOR_SOURCE_IDENTITY' }, 'textual companion format and identity remain authoritative');
  }
  await fs.writeFile(primaryPath, JSON.stringify({ ...primary, totalRecords: 5 }));
  assert.throws(() => resolveVectorsSource(path.join(root, base), options), { code: 'ERR_DENSE_VECTOR_VALIDITY' });
  await fs.writeFile(primaryPath, primaryBytes);

  const bytes = await fs.readFile(path.join(root, `${base}.bin`));
  await fs.writeFile(path.join(root, `${base}.bin`), bytes.subarray(0, bytes.length - 1));
  const truncated = resolveVectorsSource(path.join(root, base), options);
  await assert.rejects(async () => { for await (const row of truncated.rows) void row; }, { code: 'ERR_DENSE_VECTOR_STREAM' });
  await fs.writeFile(path.join(root, `${base}.bin`), Buffer.from(bytes.map((value, index) => index ? value : value ^ 1)));
  const wrongChecksum = resolveVectorsSource(path.join(root, base), options);
  await assert.rejects(async () => { for await (const row of wrongChecksum.rows) void row; }, { code: 'ERR_DENSE_VECTOR_STREAM' },
    'manifest-selected xxh64 bytes are verified before successful iterator completion');
  await writePiecesManifest(root, pieces.filter(piece => piece.name !== 'dense_vectors_doc_binary_meta'));
  assert.throws(() => resolveVectorsSource(path.join(root, base), options), { code: 'ERR_DENSE_VECTOR_SOURCE_IDENTITY' });
  console.log('Canonical binary vector source preserves sparse ordinals, masks and manifest authority without textual payload reads.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
