#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { EPHEMERAL_EXTERNAL_CACHE_TTL_MS } from '../../../src/index/build/import-resolution/constants.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testLogs', 'import-external-fallback-ephemeral-cache');
const srcRoot = path.join(tempRoot, 'src');
const nonIndexedTarget = path.join(tempRoot, 'generated', 'local.js');

const importsByFile = {
  'src/main.js': ['../generated/local.js']
};
const entries = [
  { abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }
];
const fileHashes = new Map([['src/main.js', 'hash-main']]);
const cache = {};

const makeStats = () => ({
  files: 0,
  filesHashed: 0,
  filesReused: 0,
  filesInvalidated: 0,
  specs: 0,
  specsReused: 0,
  specsComputed: 0,
  packageInvalidated: false,
  fileSetInvalidated: false
});

const runOnce = () => {
  const relations = new Map([
    ['src/main.js', { imports: ['../generated/local.js'] }]
  ]);
  const cacheStats = makeStats();
  const result = resolveImportLinks({
    root: tempRoot,
    entries,
    importsByFile,
    fileRelations: relations,
    enableGraph: false,
    cache,
    cacheStats,
    fileHashes,
    mode: 'code'
  });
  return {
    relation: relations.get('src/main.js'),
    result,
    cacheStats
  };
};

const originalNow = Date.now;
let nowMs = 1_700_000_000_000;
Date.now = () => nowMs;

try {
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(srcRoot), { recursive: true });
  await fs.mkdir(path.dirname(nonIndexedTarget), { recursive: true });
  await fs.writeFile(path.join(srcRoot, 'main.js'), "import '../generated/local.js';\n");
  await fs.writeFile(nonIndexedTarget, 'export const local = true;\n');

  const first = runOnce();
  assert.deepEqual(first.relation?.importLinks || [], []);
  assert.deepEqual(
    first.relation?.externalImports || [],
    ['../generated/local.js'],
    'expected non-indexed local fallback to classify as external'
  );

  const cachedSpec = cache?.files?.['src/main.js']?.specs?.['../generated/local.js'];
  assert.equal(cachedSpec?.cacheClass, 'ephemeral_external');
  assert.equal(cachedSpec?.fallbackPath, 'generated/local.js');
  assert.equal(
    cachedSpec?.expiresAt,
    nowMs + EPHEMERAL_EXTERNAL_CACHE_TTL_MS,
    'expected ephemeral external cache entry to carry short TTL'
  );

  nowMs += 1000;
  const second = runOnce();
  assert.deepEqual(second.relation?.externalImports || [], ['../generated/local.js']);
  assert.equal(second.cacheStats.specsReused, 1, 'expected warm cache reuse before TTL expiry');
  assert.equal(second.cacheStats.specsComputed, 0);

  nowMs = cachedSpec.expiresAt + 1;
  const third = runOnce();
  assert.deepEqual(
    third.relation?.externalImports || [],
    ['../generated/local.js'],
    'expected TTL expiry to force recompute but preserve external fallback while target exists'
  );
  assert.equal(third.cacheStats.specsReused, 0);
  assert.equal(third.cacheStats.specsComputed, 1);

  await fs.rm(nonIndexedTarget, { force: true });
  nowMs += 1;
  const fourth = runOnce();
  assert.deepEqual(fourth.relation?.externalImports || [], []);
  assert.equal(
    fourth.result?.stats?.unresolved || 0,
    1,
    'expected existence revalidation to invalidate stale external fallback'
  );

  await fs.rm(tempRoot, { recursive: true, force: true });
  console.log('import external fallback ephemeral cache test passed');
} finally {
  Date.now = originalNow;
}
