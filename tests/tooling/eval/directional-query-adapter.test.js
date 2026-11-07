import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { directionalQuerySpec, directionalQueryHash as hash } from '../../helpers/directional-query.js';
import { createDirectionalQueryArtifact, createIdentityDirectionalQueryArtifact, openDirectionalQueryAdapter,
  inspectDirectionalQueryAdapter, exportDirectionalQueryAdapter, projectDirectionalQuery,
  disposeDirectionalQueryAdapter } from '../../../src/shared/retrieval-adaptation/directional-query.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/directional-query-adapter/')[1];
assert.ok(['identity-and-byte-export', 'independent-dense-reference', 'directional-contract-rejection',
  'factor-integrity-and-numerical-failures', 'private-ownership-and-retirement'].includes(mode));
const apply = (handle, spec, query) => projectDirectionalQuery(handle, { query, queryContract: spec.query, documentContract: spec.document });
const normalize = vector => { const norm = Math.hypot(...vector); return Float32Array.from(vector, value => value / norm); };
const equalVector = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-6, `column ${i}: ${actual[i]} vs ${expected[i]}`);
};
const rehash = artifact => {
  const { pairId: _pair, ...content } = artifact;
  artifact.pairId = semanticHash('directional-query.artifact.v1', content, { maxBytes: 4 * 1024 * 1024 }); return artifact;
};
if (mode === 'identity-and-byte-export') {
  const spec = directionalQuerySpec(), artifact = createIdentityDirectionalQueryArtifact(spec), handle = openDirectionalQueryAdapter(artifact);
  const query = new Float32Array([1, 2, -3, 4]), before = Buffer.from(query.buffer).toString('hex');
  const result = apply(handle, spec, query);
  assert.deepEqual(result.vector, normalize(query)); assert.equal(Buffer.from(query.buffer).toString('hex'), before);
  assert.notEqual(result.vector.buffer, query.buffer); assert.equal(result.pairId, artifact.pairId);
  assert.equal(result.queryCacheIdentity, artifact.pairId); assert.equal(result.policyQualification, 'not-established');
  assert.deepEqual(exportDirectionalQueryAdapter(handle), JSON.parse(JSON.stringify(artifact)));
  assert.equal(createIdentityDirectionalQueryArtifact(spec).pairId, artifact.pairId);
  const alternate = createIdentityDirectionalQueryArtifact(spec, { seed: 'different' });
  assert.notEqual(alternate.pairId, artifact.pairId);
  assert.ok(Buffer.from(artifact.u.data, 'base64').every(value => value === 0));
  assert.ok(Buffer.from(artifact.v.data, 'base64').some(value => value !== 0), 'V retains a nonzero first-gradient path');
  assert.deepEqual(apply(openDirectionalQueryAdapter(alternate), spec, query).vector, result.vector);
  assert.deepEqual(result.work, { factorMultiplyAdds: 16, residualAdds: 4, normalizationElements: 4, denseMatrixMaterialized: false });
} else if (mode === 'independent-dense-reference') {
  const spec = directionalQuerySpec({ trained: true }), d = 4, r = 2;
  const u = new Float32Array([0.2, -0.3, 0.4, 0.1, -0.2, 0.8, 0.3, 0.4]);
  const v = new Float32Array([0.1, 0.4, 0.5, -0.2, -0.6, 0.7, 0.9, 0.1]);
  const artifact = createDirectionalQueryArtifact({ spec, u, v }), handle = openDirectionalQueryAdapter(artifact);
  const dense = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) =>
    (i === j ? 1 : 0) + Array.from({ length: r }, (_, k) => u[i * r + k] * v[j * r + k]).reduce((a, b) => a + b, 0)));
  for (const query of [new Float32Array([1, 2, 3, 4]), new Float32Array([-1, 0, 4, -3]), new Float32Array([1e-30, 0, 0, 0])]) {
    const reference = normalize(dense.map(row => row.reduce((sum, value, i) => sum + value * query[i], 0)));
    equalVector(apply(handle, spec, query).vector, reference);
    equalVector(apply(openDirectionalQueryAdapter(JSON.parse(JSON.stringify(artifact))), spec, query).vector, reference);
  }
  assert.equal(inspectDirectionalQueryAdapter(handle).deployment, 'offline-candidate-only');
} else if (mode === 'directional-contract-rejection') {
  const spec = directionalQuerySpec(), handle = openDirectionalQueryAdapter(createIdentityDirectionalQueryArtifact(spec));
  for (const change of [doc => { doc.provider = 'onnx'; }, doc => { doc.modelId = 'fixture/other'; },
    doc => { doc.artifact.digest = hash('other-model-same-width'); }, doc => { doc.role = 'code'; },
    doc => { doc.poolingId = hash('other-pool'); }, doc => { doc.mergePolicyId = hash('other-merge'); },
    doc => { doc.normalizationId = hash('other-norm'); }, doc => { doc.representation = 'dequantized-q8-float32'; doc.quantizationId = hash('q8'); }]) {
    const documentContract = structuredClone(spec.document); change(documentContract);
    assert.throws(() => projectDirectionalQuery(handle, { query: [1, 0, 0, 0], queryContract: spec.query, documentContract }), { code: 'ERR_RETRIEVAL_ADAPTATION' });
  }
  const wrongQuery = structuredClone(spec.query); wrongQuery.inputFormattingId = hash('other-query-role-format');
  assert.throws(() => projectDirectionalQuery(handle, { query: [1, 0, 0, 0], queryContract: wrongQuery, documentContract: spec.document }), { code: 'ERR_RETRIEVAL_ADAPTATION' });
  const mismatched = structuredClone(spec); mismatched.document.dimensions = 3;
  assert.throws(() => createIdentityDirectionalQueryArtifact(mismatched));
  const unknown = structuredClone(spec); unknown.query.artifact.digest = null;
  assert.throws(() => createIdentityDirectionalQueryArtifact(unknown), { code: 'ERR_EMBEDDING_ARTIFACT_INCOMPATIBLE' });
  const quantized = structuredClone(spec); quantized.document.quantizationId = hash('quantized');
  assert.throws(() => createIdentityDirectionalQueryArtifact(quantized));
} else if (mode === 'factor-integrity-and-numerical-failures') {
  const spec = directionalQuerySpec(), artifact = createIdentityDirectionalQueryArtifact(spec);
  for (const data of [artifact.v.data.slice(4), artifact.v.data + '\n', '!!!!']) {
    const changed = structuredClone(artifact); changed.v.data = data; rehash(changed);
    assert.throws(() => openDirectionalQueryAdapter(changed));
  }
  const nonfinite = structuredClone(artifact), bytes = Buffer.from(nonfinite.v.data, 'base64'); bytes.writeFloatLE(NaN, 0);
  nonfinite.v.data = bytes.toString('base64'); nonfinite.v.sha256 = createHash('sha256').update(bytes).digest('hex'); rehash(nonfinite);
  assert.throws(() => openDirectionalQueryAdapter(nonfinite));
  const handle = openDirectionalQueryAdapter(artifact);
  for (const query of [[0, 0, 0, 0], [Infinity, 1, 2, 3], [NaN, 1, 2, 3], [1e100, 1, 2, 3], [], new Array(4)]) assert.throws(() => apply(handle, spec, query));
  let accessed = false; const accessor = [1, 0, 0, 0]; Object.defineProperty(accessor, 0, { get() { accessed = true; return 1; } });
  assert.throws(() => apply(handle, spec, accessor)); assert.equal(accessed, false);
  const singular = directionalQuerySpec({ dimensions: 1, rank: 1, trained: true });
  const zero = openDirectionalQueryAdapter(createDirectionalQueryArtifact({ spec: singular, u: [-1], v: [1] }));
  assert.throws(() => apply(zero, singular, [1]), /zero or invalid norm/);
  assert.throws(() => createDirectionalQueryArtifact({ spec, u: new Float32Array(8).fill(1), v: new Float32Array(8) }), /U=0/);
} else {
  const spec = directionalQuerySpec({ trained: true }), u = new Float32Array(8).fill(0.1), v = new Float32Array(8).fill(0.2);
  const artifact = createDirectionalQueryArtifact({ spec, u, v }), packet = structuredClone(artifact), handle = openDirectionalQueryAdapter(packet);
  const before = apply(handle, spec, [1, 2, 3, 4]).vector; u.fill(100); v.fill(100); packet.v.data = 'corrupted';
  assert.deepEqual(apply(handle, spec, [1, 2, 3, 4]).vector, before);
  assert.throws(() => inspectDirectionalQueryAdapter({ ...handle }));
  const receipt = disposeDirectionalQueryAdapter(handle); assert.equal(receipt.status, 'retired'); assert.equal(receipt.nativeResources, 'none');
  assert.equal(disposeDirectionalQueryAdapter(handle), receipt); assert.throws(() => apply(handle, spec, [1, 2, 3, 4]));
  assert.equal(exportDirectionalQueryAdapter(openDirectionalQueryAdapter(artifact)).pairId, artifact.pairId);
}
console.log('Directional query factors preserve exact pairing, independent numerical parity and private ownership.');
