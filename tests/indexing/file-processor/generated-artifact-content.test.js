#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  classifyGeneratedArtifactContentPrefix,
  createMapCacheEnvelope,
  generatedMapCacheIdentity
} from '../../../src/shared/generated-artifact.js';
import { resolvePreCpuFileContent } from '../../../src/index/build/file-processor/pre-cpu-content.js';
import { buildContentConfigHash, normalizeContentConfig } from '../../../src/index/build/runtime/hash.js';
import { sha1 } from '../../../src/shared/hash.js';
import { stableStringifyForSignature } from '../../../src/shared/stable-json.js';

const repoRoot = process.cwd();
const map = { version: '1.0.0', generatedAt: '2026-10-06T00:00:00.000Z',
  root: { path: repoRoot, id: 'fixture' }, mode: 'code', options: { include: ['imports'] },
  legend: {}, nodes: [], edges: [] };
const { key } = generatedMapCacheIdentity('content-fixture');
const text = JSON.stringify(createMapCacheEnvelope(map, key));
const classify = value => classifyGeneratedArtifactContentPrefix({ prefix: Buffer.from(value), repoRoot });
assert.equal(classify(text)?.action, 'omit');
assert.equal(classify(JSON.stringify({ documentation: text })), null);
assert.equal(classify(`// quoted example\n${text}`), null);
assert.equal(classify(JSON.stringify(createMapCacheEnvelope({ authored: true }, key))), null,
  'renamed recognition requires an actual map model header');
assert.equal(classify(text.replace('"flags":1', '"flags":1,"flags":1')), null);
assert.equal(classify(text.replace('poc.generated@1', 'poc.generated@99')), null);
assert.equal(classify(text.replace('"flags":1', '"flags":3')), null);
assert.equal(classify(text.replace(key, 'invalid-key')), null);

let reads = 0;
const checkContent = async (contents, mode = 'code') => {
  const buffer = Buffer.from(contents);
  const artifacts = { fileBuffer: buffer };
  const result = await resolvePreCpuFileContent({
    abs: '/already-read/renamed.json', repoRoot, relKey: 'renamed.json', mode, ext: '.json',
    fileStat: { size: buffer.length, mtimeMs: 1 }, fileScanner: {},
    runIo: () => { reads += 1; throw new Error('No extra filesystem read is permitted'); },
    throwIfAborted() {}, updateCrashStage() {}, formatCrashErrorMeta: error => ({ message: error.message }),
    warnEncodingFallback() {}, documentSourceType: null, artifacts
  });
  return { result, artifacts };
};
const owned = await checkContent(text);
assert.equal(owned.result.skip.reason, 'generated-artifact');
assert.equal(owned.artifacts.text, undefined, 'omit before decoding/parsing/chunking');
const quoted = await checkContent(JSON.stringify({ documentation: text }));
assert.equal(quoted.result.skip, null);
const records = await checkContent(text, 'records');
assert.equal(records.result.skip, null, 'explicit records retain their searchable semantic role');
assert.equal(reads, 0, 'classification must reuse the existing source buffer');

const config = { indexing: { typeInference: false } };
const env = { cacheRoot: '/fixture-cache' };
const oldHash = sha1(stableStringifyForSignature({ config: normalizeContentConfig(config), env: { ...env, cacheRoot: '' } }));
assert.notEqual(buildContentConfigHash(config, env), oldHash,
  'policy migration must invalidate bundles created before content classification');
assert.equal(buildContentConfigHash(config, env), buildContentConfigHash(config, { cacheRoot: '/elsewhere' }));

const ordinary = Buffer.from('export function authored() { return "poc.generated@1"; }');
const start = performance.now();
for (let i = 0; i < 10000; i++) {
  assert.equal(classifyGeneratedArtifactContentPrefix({ prefix: ordinary, repoRoot }), null);
}
console.log(`Content-marker guard: 10000 already-read authored buffers in ${(performance.now() - start).toFixed(2)} ms; zero extra I/O.`);
