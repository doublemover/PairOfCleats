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
  label: 'sqlite-bundle-metav2-fallback-order-parity',
  dbName: 'index-prose.db'
});

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

await writeSingleChunkBundle({
  bundleDir,
  bundleName: firstBundleName,
  file: firstFile,
  chunk: {
    file: firstFile,
    start: 1,
    end: 10,
    ext: '.md',
    tokens: ['alpha'],
    chunkId: firstMeta.chunkId,
    metaV2: firstMeta
  }
});
await writeSingleChunkBundle({
  bundleDir,
  bundleName: secondBundleName,
  file: secondFile,
  chunk: {
    file: secondFile,
    start: 11,
    end: 20,
    ext: '.md',
    tokens: ['beta'],
    chunkId: secondMeta.chunkId,
    metaV2: secondMeta
  }
});

const manifest = createBundleManifest([
  { file: firstFile, bundles: [firstBundleName], mtimeMs: 10, size: 10, hash: 'hash-z' },
  { file: secondFile, bundles: [secondBundleName], mtimeMs: 20, size: 20, hash: 'hash-a' }
]);

const result = await buildBundleDatabase({
  Database,
  dbPath,
  mode: 'prose',
  manifest,
  bundleDir
});

assert.equal(result.count, 2, `expected 2 indexed chunks, got ${result.count}`);

const rows = readBundleRows({ Database, dbPath, mode: 'prose' });
const chunkMeta = [
  { id: 0, metaV2: firstMeta },
  { id: 1, metaV2: secondMeta }
];
assertMetaV2Parity({ mode: 'prose', chunkMeta, rows });

assert.deepEqual(
  rows.map((row) => row.chunk_id),
  ['chunk-z', 'chunk-a'],
  `expected sqlite chunk_id order chunk-z,chunk-a, got ${rows.map((row) => row.chunk_id).join(',')}`
);

console.log('sqlite bundle fallback-order metaV2 parity test passed');
