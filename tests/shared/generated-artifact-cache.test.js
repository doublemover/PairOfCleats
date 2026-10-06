#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  withGeneratedCacheMetadata,
  withoutGeneratedCacheMetadata,
  classifyGeneratedArtifactCachePrefix,
  isGeneratedArtifactCacheCandidatePath
} from '../../src/shared/generated-artifact-cache.js';

const hash = 'a'.repeat(40);
const cases = [
  ['tree-sitter-chunks', `custom/tr/tree-sitter-chunk_lk1_${hash}.json`],
  ['cross-file-inference', 'custom/cross-file-inference/output-cache.json'],
  ['import-resolution', 'custom/import-resolution-cache.json'],
  ['import-resolution-persist-failure', 'custom/import-resolution-cache.json.fail-open.json'],
  ['scm-file-meta', 'custom/scm/file-meta-v1.json'],
  ['lsp-requests', 'custom/lsp/request-cache-v1.json'],
  ['command-probe', `custom/command-probes/${hash}.json`],
  ['workspace-preflight', `custom/workspace-preflight/${hash}/cargo-check.json`],
  ['pyright-planner-health', `custom/pyright-planner/${hash}.json`],
  ['pyright-runtime-health', `custom/pyright-runtime/${hash}.json`],
  ['learned-auto-profile', 'custom/runtime/learned-auto-profile.json'],
  ['scheduler-autotune', 'custom/metrics/scheduler-autotune.json'],
  ['tree-sitter-adaptive-profile', 'custom/adaptive-rows-per-sec.json'],
  ['embeddings-autotune', 'custom/metrics/embeddings-autotune.json'],
  ['enrichment-state', 'custom/enrichment_state.json']
];

for (const [artifact, relativePath] of cases) {
  const input = { version: 1, entries: { 'src/app.js': { useful: true } }, extensions: { custom: true } };
  const payload = withGeneratedCacheMetadata(input, artifact);
  const prefix = JSON.stringify(payload);
  assert.equal(Object.keys(payload)[0], '__poc_generated');
  assert.deepEqual(withoutGeneratedCacheMetadata(payload), input);
  assert.equal(input.__poc_generated, undefined, 'producer helper must not mutate caller data');
  assert.equal(isGeneratedArtifactCacheCandidatePath(relativePath), true);
  assert.equal(classifyGeneratedArtifactCachePrefix({ relativePath, prefix })?.artifact, artifact);
  assert.equal(classifyGeneratedArtifactCachePrefix({ prefix })?.artifact, artifact, 'renamed already-read cache');
  assert.equal(classifyGeneratedArtifactCachePrefix({ relativePath: 'authored.json', prefix }), null);
  assert.equal(classifyGeneratedArtifactCachePrefix({ relativePath, prefix: JSON.stringify(input) }), null, 'legacy objects stay searchable');
  assert.equal(classifyGeneratedArtifactCachePrefix({ prefix: JSON.stringify({ example: payload }) }), null);
  assert.equal(classifyGeneratedArtifactCachePrefix({ prefix: prefix.slice(0, -1) }), null);
  assert.equal(classifyGeneratedArtifactCachePrefix({ prefix: prefix.replace('"flags":1', '"flags":1,"flags":1') }), null);
  assert.equal(classifyGeneratedArtifactCachePrefix({ prefix: prefix.slice(0, -1) + ',"__poc_generated":{}}' }), null);
  for (const invalid of [{ flags: 0 }, { flags: 2 }, { flags: 3 }, { format: 'poc.generated@2' }, { kind: 'unknown' }, { artifact: 'query-root-map' }, { path: 'src/app.js' }]) {
    assert.equal(classifyGeneratedArtifactCachePrefix({
      prefix: JSON.stringify({ ...payload, __poc_generated: { ...payload.__poc_generated, ...invalid } })
    }), null);
  }
  const large = JSON.stringify({ ...payload, data: 'x'.repeat(32000) });
  assert.equal(classifyGeneratedArtifactCachePrefix({ prefix: large })?.artifact, artifact);
  assert.equal(classifyGeneratedArtifactCachePrefix({ prefix: ' '.repeat(8192) + prefix }), null);
  const malformed = prefix.slice(0, -1) + ',"nested":' + '['.repeat(6000);
  assert.equal(classifyGeneratedArtifactCachePrefix({ prefix: malformed }), null, 'untrusted deep nesting cannot escape parser guard');
}
for (const name of ['pyrightconfig.json', 'queryCache.json', 'Package.resolved', 'Cargo.lock', 'cache.index.bin', `cas/meta/${hash}.json`, 'report.json']) {
  assert.equal(isGeneratedArtifactCacheCandidatePath(name), false, name);
}
const rows = [{ value: 1 }];
assert.equal(withGeneratedCacheMetadata(rows, 'lsp-requests'), rows, 'arrays cannot be stamped');
for (const native of [Buffer.from([1, 2]), new Uint8Array([1, 2]), new Map(), new Date(0)]) {
  assert.equal(withGeneratedCacheMetadata(native, 'lsp-requests'), native, 'non-record/native values cannot be stamped');
}
const rootMap = { arbitrary: { value: 1 } };
assert.equal(withGeneratedCacheMetadata(rootMap, 'query-root-map'), rootMap, 'unreviewed root dictionaries cannot be stamped');
console.log('generated object-cache metadata classifier contract passed');
