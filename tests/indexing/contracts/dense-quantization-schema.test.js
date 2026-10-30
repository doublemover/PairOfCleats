import assert from 'node:assert/strict';
import { validateArtifact } from '../../../src/contracts/artifact-schemas.js';
import { DENSE_VECTOR_ARTIFACT_SCHEMA_DEFS } from '../../../src/contracts/schemas/artifacts/dense-vectors.js';

for (const name of Object.keys(DENSE_VECTOR_ARTIFACT_SCHEMA_DEFS)) {
  const fields = { dims: 2, count: 1, vectors: [[0, 255]], path: 'dense.bin', space: 'cosine',
    m: 16, efConstruction: 100, efSearch: 50, metric: 'cosine', table: 'vectors',
    embeddingColumn: 'embedding', idColumn: 'id' };
  assert.equal(validateArtifact(name, fields).ok, true, `${name}: historical optional codec metadata`);
  const current = { ...fields, quantizationVersion: 2, minVal: -1, maxVal: 1,
    scale: 2 / 255, levels: 256, zeroPoint: 128, absence: 'validity-mask' };
  assert.equal(validateArtifact(name, current).ok, true, `${name}: current codec metadata`);
  assert.equal(validateArtifact(name, { ...current, quantizationVersion: 1 }).ok, true);
  for (const invalid of [{ quantizationVersion: 0 }, { quantizationVersion: 3 },
    { quantizationVersion: '2' }, { levels: 257 }, { levels: 1 }, { levels: 2.5 },
    { zeroPoint: -1 }, { zeroPoint: 256 }, { zeroPoint: null }, { scale: 0 },
    { scale: -1 }, { absence: 'zero-vector' }]) {
    assert.equal(validateArtifact(name, { ...current, ...invalid }).ok, false,
      `${name}: reject ${JSON.stringify(invalid)}`);
  }
  if (name === 'dense_vectors' || name === 'dense_vectors_doc' || name === 'dense_vectors_code') {
    for (const vector of [[256], [-1], [.5], ['1']]) {
      assert.equal(validateArtifact(name, { ...current, vectors: [vector] }).ok, false);
    }
    assert.equal(validateArtifact(name, { ...current, vectors: [[], [0, 255]] }).ok, true,
      'an absent row retains its established empty-row representation');
  }
}
console.log('Canonical dense artifact validators admit supported byte codecs and reject invalid declarations.');
