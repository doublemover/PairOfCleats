#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { writeBundleFile } from '../../../src/shared/bundle-io.js';
import { validateSqliteMetaV2Parity } from '../../../src/index/validate/checks.js';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.error('better-sqlite3 is required for sqlite bundle parity tests.');
  process.exit(1);
}

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-bundle-metav2-fallback-order-parity');
const bundleDir = path.join(tempRoot, 'bundles');
const dbPath = path.join(tempRoot, 'index-prose.db');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(bundleDir, { recursive: true });

const firstFile = 'z/README.md';
const secondFile = 'a/README.md';
const firstBundleName = 'bundle-z.json';
const secondBundleName = 'bundle-a.json';

const firstMeta = {
  chunkId: 'chunk-z',
  file: firstFile,
  range: { start: 1, end: 10 },
  lang: 'markdown',
  ext: '.md',
  relations: null,
  segment: null
};
const secondMeta = {
  chunkId: 'chunk-a',
  file: secondFile,
  range: { start: 11, end: 20 },
  lang: 'markdown',
  ext: '.md',
  relations: null,
  segment: null
};

await writeBundleFile({
  bundlePath: path.join(bundleDir, firstBundleName),
  format: 'json',
  bundle: {
    file: firstFile,
    chunks: [{
      file: firstFile,
      start: 1,
      end: 10,
      ext: '.md',
      tokens: ['alpha'],
      chunkId: firstMeta.chunkId,
      metaV2: firstMeta
    }]
  }
});
await writeBundleFile({
  bundlePath: path.join(bundleDir, secondBundleName),
  format: 'json',
  bundle: {
    file: secondFile,
    chunks: [{
      file: secondFile,
      start: 11,
      end: 20,
      ext: '.md',
      tokens: ['beta'],
      chunkId: secondMeta.chunkId,
      metaV2: secondMeta
    }]
  }
});

const manifest = {
  files: {
    [firstFile]: { bundles: [firstBundleName], mtimeMs: 10, size: 10, hash: 'hash-z' },
    [secondFile]: { bundles: [secondBundleName], mtimeMs: 20, size: 20, hash: 'hash-a' }
  }
};

const result = await buildDatabaseFromBundles({
  Database,
  outPath: dbPath,
  mode: 'prose',
  incrementalData: { manifest, bundleDir },
  envConfig: { bundleThreads: 1 },
  threadLimits: { fileConcurrency: 1 },
  emitOutput: false,
  validateMode: 'off',
  vectorConfig: { enabled: false },
  modelConfig: { id: null },
  workerPath: null
});

assert.equal(result.count, 2, `expected 2 indexed chunks, got ${result.count}`);

const db = new Database(dbPath, { readonly: true });
const rows = db
  .prepare('SELECT id, chunk_id, metaV2_json FROM chunks WHERE mode = ? ORDER BY id')
  .all('prose');
db.close();

const report = { issues: [], warnings: [], hints: [] };
const chunkMeta = [
  { id: 0, metaV2: firstMeta },
  { id: 1, metaV2: secondMeta }
];
validateSqliteMetaV2Parity(report, 'prose', chunkMeta, rows, { maxErrors: 10 });

assert.equal(report.issues.length, 0, `expected no sqlite metaV2 parity issues: ${report.issues.join(', ')}`);
assert.deepEqual(
  rows.map((row) => row.chunk_id),
  ['chunk-z', 'chunk-a'],
  `expected sqlite chunk_id order chunk-z,chunk-a, got ${rows.map((row) => row.chunk_id).join(',')}`
);

console.log('sqlite bundle fallback-order metaV2 parity test passed');
