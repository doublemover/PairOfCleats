#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  assertMetaV2Parity,
  buildBundleDatabase,
  createBundleManifest,
  loadSqliteBundleDatabase,
  prepareBundleBuildFixture,
  readBundleRows,
  writeSingleChunkBundle
} from './helpers/bundle-fixture.js';

const Database = await loadSqliteBundleDatabase('sqlite bundle parity tests');
const { bundleDir, dbPath } = await prepareBundleBuildFixture({
  label: 'sqlite-bundle-metav2-docid-parity',
  dbName: 'index-code.db'
});

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

await writeSingleChunkBundle({
  bundleDir,
  bundleName: bundleA,
  file: fileA,
  chunk: {
    id: 1,
    file: fileA,
    start: 1,
    end: 19,
    tokens: ['alpha'],
    chunkId: 'chunk-a',
    metaV2: chunkMetaA
  }
});
await writeSingleChunkBundle({
  bundleDir,
  bundleName: bundleB,
  file: fileB,
  chunk: {
    id: 0,
    file: fileB,
    start: 20,
    end: 40,
    tokens: ['beta'],
    chunkId: 'chunk-b',
    metaV2: chunkMetaB
  }
});

const manifest = createBundleManifest([
  { file: fileA, bundles: [bundleA], mtimeMs: 10, size: 10, hash: 'hash-a' },
  { file: fileB, bundles: [bundleB], mtimeMs: 20, size: 20, hash: 'hash-b' }
]);

const result = await buildBundleDatabase({
  Database,
  dbPath,
  mode: 'code',
  manifest,
  bundleDir
});

assert.equal(result.count, 2, `expected 2 indexed chunks, got ${result.count}`);

const rows = readBundleRows({ Database, dbPath, mode: 'code' });
const chunkMeta = [
  { id: 0, metaV2: chunkMetaB },
  { id: 1, metaV2: chunkMetaA }
];
assertMetaV2Parity({ mode: 'code', chunkMeta, rows });

assert.deepEqual(
  rows.map((row) => row.id),
  [0, 1],
  `expected sqlite chunk ids [0,1], got ${rows.map((row) => row.id).join(',')}`
);

console.log('sqlite bundle metaV2 docId parity test passed');
