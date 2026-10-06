#!/usr/bin/env node
import assert from 'node:assert/strict';
import { withGeneratedArtifactMetadata, classifyGeneratedArtifactCorePrefix, isGeneratedArtifactCoreCandidatePath } from '../../src/shared/generated-artifact-core.js';
import { buildShardedJsonlMetaFields } from '../../src/index/build/artifacts/writers/_common.js';
import { SHARDED_META_ARTIFACT_SCHEMA_DEFS } from '../../src/contracts/schemas/artifacts/sharded-meta.js';
import { validateArtifact } from '../../src/contracts/artifact-schemas.js';

const classify = (fields, relativePath) => classifyGeneratedArtifactCorePrefix({ prefix: JSON.stringify(fields), relativePath });
for (const [schema, definition] of Object.entries(SHARDED_META_ARTIFACT_SCHEMA_DEFS)) {
  const artifact = definition.properties.artifact.const;
  const fields = buildShardedJsonlMetaFields({ artifact, extensions: { caller: 'x'.repeat(16000) } });
  assert.equal(Object.keys(fields)[0], 'extensions');
  assert.equal(Object.keys(fields.extensions)[0], '__poc_generated');
  assert.ok(validateArtifact(schema, fields).ok, schema);
  assert.equal(classify(fields, `${artifact}.meta.json`)?.kind, 'sharded-meta', schema);
  assert.equal(classify(fields)?.artifact, artifact, 'renamed metadata uses already-read prefix');
  assert.equal(classify(fields, 'authored.json'), null, 'path-bound classifier rejects other names');
  assert.ok(!validateArtifact(schema, { ...fields, __poc_generated: fields.extensions.__poc_generated }).ok);
}

const fixtures = [
  ['pieces-manifest', 'custom/pieces/manifest.json'],
  ['index-state', 'custom/index_state.json'],
  ['index-state-meta', 'custom/index_state.meta.json'],
  ['builds-current', 'custom/builds/current.json'],
  ['token-postings-meta', 'custom/token_postings.meta.json'],
  ['file-meta', 'custom/file_meta.meta.json', 'file_meta'],
  ['dense-vector-meta', 'custom/dense_vectors_uint8.meta.json', 'dense_vectors_uint8']
];
for (const [kind, file, artifact] of fixtures) {
  const input = { value: 1, extensions: { __poc_generated: { stale: true }, retained: 2 } };
  const marked = withGeneratedArtifactMetadata(input, kind, artifact);
  assert.equal(input.extensions.__poc_generated.stale, true, 'construction must not mutate callers');
  assert.equal(marked.extensions.retained, 2);
  assert.ok(isGeneratedArtifactCoreCandidatePath(file));
  assert.equal(classify(marked, file)?.kind, kind);
  assert.equal(classify(marked)?.kind, kind);
  assert.equal(classify({ examples: marked }, file), null);
  assert.equal(classify({ ...marked, extensions: { retained: 2, __poc_generated: marked.extensions.__poc_generated } }, file), null);
  for (const patch of [{ flags: 3 }, { flags: 2 }, { format: 'poc.generated@2' }, { kind: 'unknown' }, { path: 'src/app.js' }]) {
    const altered = { ...marked, extensions: { __poc_generated: { ...marked.extensions.__poc_generated, ...patch } } };
    assert.equal(classify(altered, file), null);
    assert.equal(classify(altered), null);
  }
  const prefix = JSON.stringify(marked);
  assert.equal(classifyGeneratedArtifactCorePrefix({ prefix: prefix.slice(0, -1) }), null, 'truncated short document');
  assert.equal(classifyGeneratedArtifactCorePrefix({ prefix: prefix.replace('"retained":2', '"retained":2,"__poc_generated":{}') }), null, 'duplicate marker island');
  assert.equal(classifyGeneratedArtifactCorePrefix({ prefix: prefix.slice(0, -1) + ',"extensions":{}}' }), null, 'duplicate extensions field');
  assert.equal(classifyGeneratedArtifactCorePrefix({ relativePath: file, prefix: prefix.replace('"flags":1', '"flags":1,"flags":1') }), null);
  assert.equal(classifyGeneratedArtifactCorePrefix({ prefix: ' '.repeat(8192) + prefix }), null);
  assert.equal(classifyGeneratedArtifactCorePrefix({ prefix: prefix.slice(0, 50) }), null);
}
assert.equal(isGeneratedArtifactCoreCandidatePath('src/current.json'), false);
assert.equal(isGeneratedArtifactCoreCandidatePath('src/manifest.json'), false);
assert.equal(isGeneratedArtifactCoreCandidatePath('chunk_meta.parts/chunk_meta.part-00001.jsonl'), false);
assert.equal(isGeneratedArtifactCoreCandidatePath('dense_vectors.lancedb/authored.json'), false);
const unknown = { artifact: 'authored', extensions: { custom: true } };
assert.equal(withGeneratedArtifactMetadata(unknown, 'sharded-meta', 'authored'), unknown);
const nestedPrefix = '{"extensions":{"__poc_generated":{"format":"poc.generated@1","kind":"index-state","flags":1}},"nested":' + '['.repeat(6000);
assert.equal(classifyGeneratedArtifactCorePrefix({ prefix: nestedPrefix }), null,
  'deeply nested malformed JSON must fail open without throwing from the parser');
for (const [schema, kind, fields] of [
  ['index_state', 'index-state', { generatedAt: '2026-10-06T00:00:00Z', mode: 'code', artifactSurfaceVersion: '1.0.0' }],
  ['pieces_manifest', 'pieces-manifest', { version: 2, artifactSurfaceVersion: '1.0.0', pieces: [] }],
  ['builds_current', 'builds-current', { buildId: 'b1', buildRoot: 'builds/b1', promotedAt: '2026-10-06T00:00:00Z', artifactSurfaceVersion: '1.0.0' }]
]) {
  const marked = withGeneratedArtifactMetadata(fields, kind);
  assert.ok(validateArtifact(schema, marked).ok, schema);
  assert.ok(!validateArtifact(schema, { ...fields, __poc_generated: marked.extensions.__poc_generated }).ok,
    `${schema} must keep its strict root contract`);
}
console.log('generated core metadata contract test passed');
