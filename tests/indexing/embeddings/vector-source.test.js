#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareArtifactIoTestDir, writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { resolveVectorsSource } from '../../../tools/build/embeddings/vector-source.js';

const root = process.cwd();
const testRoot = await prepareArtifactIoTestDir('embedding-vector-source', { root });

const writeJson = async (filePath, payload) => {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

await fs.writeFile(
  path.join(testRoot, 'dense_vectors_uint8.part-000.jsonl'),
  [
    JSON.stringify({ vector: [1, 2, 3] }),
    JSON.stringify({ values: [4, 5, 6] })
  ].join('\n'),
  'utf8'
);
await writeJson(path.join(testRoot, 'dense_vectors_uint8.meta.json'), {
  totalRecords: 2,
  parts: ['dense_vectors_uint8.part-000.jsonl']
});
await writePiecesManifest(testRoot, [
  { name: 'dense_vectors', path: 'dense_vectors_uint8.json', format: 'json' }
]);

const hnswShardSource = resolveVectorsSource(path.join(testRoot, 'dense_vectors_uint8'), {
  includeCanonicalBase: true,
  requireManifestDeclaration: true,
  tryCandidateJson: true
});
assert.equal(hnswShardSource?.count, 2);
assert.equal(hnswShardSource?.vectors, null);
assert.equal(typeof hnswShardSource?.rows?.[Symbol.asyncIterator], 'function');
const shardRows = [];
for await (const row of hnswShardSource.rows) {
  shardRows.push(row);
}
assert.deepEqual(shardRows, [{ vector: [1, 2, 3] }, { values: [4, 5, 6] }]);

await writeJson(path.join(testRoot, 'dense_vectors_code_uint8.json'), {
  arrays: {
    vectors: [[7, 8], [9, 10]]
  }
});
const hnswJsonSource = resolveVectorsSource(path.join(testRoot, 'dense_vectors_code_uint8'), {
  includeCanonicalBase: true,
  requireManifestDeclaration: false,
  tryCandidateJson: true
});
assert.equal(hnswJsonSource?.count, 2);
assert.deepEqual(hnswJsonSource?.vectors, [[7, 8], [9, 10]]);

await writeJson(path.join(testRoot, 'dense_vectors_lance.json'), {
  vectors: [[1, 1]]
});
await writeJson(path.join(testRoot, 'dense_vectors_lance.meta.json'), {
  totalRecords: 1,
  parts: []
});
const lanceSource = resolveVectorsSource(path.join(testRoot, 'dense_vectors_lance.json'), {
  stopOnShardMetaWithoutManifest: true
});
assert.equal(lanceSource, null);

console.log('embedding vector source test passed');
