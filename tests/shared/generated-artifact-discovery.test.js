#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  GENERATED_ARTIFACT_PREFIX_BYTES,
  classifyGeneratedArtifactPrefix,
  createMapCacheEnvelope,
  generatedMapCacheIdentity,
  inspectGeneratedArtifact,
  readMapCacheEnvelope
} from '../../src/shared/generated-artifact.js';

const repoRoot = process.cwd();
const identity = generatedMapCacheIdentity('code-map:lk1:fixture');
const map = { version: '1.0.0', generatedAt: '2026-10-06T00:00:00.000Z',
  root: { path: repoRoot, id: 'fixture' }, mode: 'code',
  options: { include: ['imports'] }, legend: {}, nodes: [], edges: [] };
const envelope = createMapCacheEnvelope(map, identity.key);
const prefix = JSON.stringify(envelope);
const classify = (relativePath, contents = prefix) => classifyGeneratedArtifactPrefix({
  relativePath, prefix: Buffer.from(contents), repoRoot
});
assert.deepEqual(readMapCacheEnvelope(JSON.parse(prefix), identity.key), map);
assert.equal(classify(`custom/inside-repo/${identity.fileName}`).action, 'omit');
assert.equal(classify(identity.fileName).kind, 'code-map-cache');
assert.equal(classify('docs/example.json'), null);
assert.equal(classify('src/example.js'), null);
assert.equal(classify(identity.fileName, JSON.stringify({ documentation: prefix })), null);
assert.equal(classify(identity.fileName, `// example\n${prefix}`), null);
assert.equal(classify(identity.fileName, prefix.replace(identity.key, 'f'.repeat(64))), null);
assert.equal(classify(identity.fileName, prefix.replace('poc.generated@1', 'poc.generated@99')), null);
assert.equal(classify(identity.fileName, prefix.replace('"flags":1', '"flags":255')), null);
assert.equal(classify(identity.fileName, prefix.replace('"flags":1', '"flags":0,"flags":1')), null);
assert.equal(classify(identity.fileName, prefix.replace('"kind":"code-map-cache"', '"kind":"other","kind":"code-map-cache"')), null);
assert.equal(classify(identity.fileName, prefix.replace('"flags":1', '"flags":1,"exclude":["src"]')), null);
assert.equal(classify(identity.fileName, `${' '.repeat(GENERATED_ARTIFACT_PREFIX_BYTES)}${prefix}`), null);
const legacy = `.pairofcleats/maps/cache/code-map:lk1:${'a'.repeat(40)}.json`;
assert.equal(classify(legacy, JSON.stringify(map, null, 2)).format, 'legacy-code-map@1');
assert.equal(classify(legacy, JSON.stringify({ authored: 'ordinary JSON' })), null);
assert.equal(classify(legacy, JSON.stringify(map).replace('"version":"1.0.0"', '"version":"other","version":"1.0.0"')), null);
assert.equal(classify(legacy, JSON.stringify({ ...map, root: { path: '/unrelated', id: 'other' } })), null);
assert.equal(classify(`docs/code-map:lk1:${'a'.repeat(40)}.json`, JSON.stringify(map)), null);

let reads = 0;
const reader = async (_root, _file, limit) => {
  reads += 1;
  assert.equal(limit, 8192);
  return Buffer.from(prefix);
};
const started = performance.now();
for (let i = 0; i < 10000; i++) {
  assert.equal(await inspectGeneratedArtifact({ repoRoot, filePath: `file-${i}.json`,
    relativePath: `src/file-${i}.json`, readPrefix: reader }), null);
}
assert.equal(reads, 0, 'ordinary paths must perform no marker reads');
const durationMs = performance.now() - started;
assert.equal((await inspectGeneratedArtifact({ repoRoot, filePath: identity.fileName,
  relativePath: identity.fileName, readPrefix: reader })).action, 'omit');
assert.equal(reads, 1, 'a candidate uses exactly one bounded prefix read');
console.log(`Generated-artifact guard: 10000 ordinary paths, zero reads, ${durationMs.toFixed(2)} ms; candidate read cap 8192 bytes.`);
