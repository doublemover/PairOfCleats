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
const tempRoot = resolveTestCachePath(root, 'sqlite-bundle-metav2-docid-parity');
const bundleDir = path.join(tempRoot, 'bundles');
const dbPath = path.join(tempRoot, 'index-code.db');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(bundleDir, { recursive: true });

const fileA = 'a/FileA.swift';
const fileB = 'b/FileB.swift';
const bundleA = 'bundle-a.json';
const bundleB = 'bundle-b.json';

const chunkMetaB = {
  chunkId: 'chunk-b',
  file: fileB,
  range: { start: 20, end: 40 },
  lang: 'swift',
  ext: '.swift',
  relations: { calls: [{ targetChunkId: 'callee-b' }] },
  segment: { segmentId: 'seg-b', segmentUid: 'seguid-b', virtualPath: `vfs://${fileB}` }
};
const chunkMetaA = {
  chunkId: 'chunk-a',
  file: fileA,
  range: { start: 1, end: 19 },
  lang: 'swift',
  ext: '.swift',
  relations: { calls: [{ targetChunkId: 'callee-a' }] },
  segment: { segmentId: 'seg-a', segmentUid: 'seguid-a', virtualPath: `vfs://${fileA}` }
};

await writeBundleFile({
  bundlePath: path.join(bundleDir, bundleA),
  format: 'json',
  bundle: {
    file: fileA,
    chunks: [{
      id: 1,
      file: fileA,
      start: 1,
      end: 19,
      tokens: ['alpha'],
      chunkId: 'chunk-a',
      metaV2: chunkMetaA
    }]
  }
});
await writeBundleFile({
  bundlePath: path.join(bundleDir, bundleB),
  format: 'json',
  bundle: {
    file: fileB,
    chunks: [{
      id: 0,
      file: fileB,
      start: 20,
      end: 40,
      tokens: ['beta'],
      chunkId: 'chunk-b',
      metaV2: chunkMetaB
    }]
  }
});

const manifest = {
  files: {
    [fileA]: { bundles: [bundleA], mtimeMs: 10, size: 10, hash: 'hash-a' },
    [fileB]: { bundles: [bundleB], mtimeMs: 20, size: 20, hash: 'hash-b' }
  }
};

const result = await buildDatabaseFromBundles({
  Database,
  outPath: dbPath,
  mode: 'code',
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
  .all('code');
db.close();

const report = { issues: [], warnings: [], hints: [] };
const chunkMeta = [
  { id: 0, metaV2: chunkMetaB },
  { id: 1, metaV2: chunkMetaA }
];
validateSqliteMetaV2Parity(report, 'code', chunkMeta, rows, { maxErrors: 10 });

assert.equal(report.issues.length, 0, `expected no sqlite metaV2 parity issues: ${report.issues.join(', ')}`);
assert.deepEqual(
  rows.map((row) => row.id),
  [0, 1],
  `expected sqlite chunk ids [0,1], got ${rows.map((row) => row.id).join(',')}`
);

console.log('sqlite bundle metaV2 docId parity test passed');
