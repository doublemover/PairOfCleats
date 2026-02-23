#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { sha1 } from '../../../src/shared/hash.js';
import { createTreeSitterSchedulerLookup } from '../../../src/index/build/tree-sitter-scheduler/lookup.js';
import { resolveTreeSitterSchedulerPaths } from '../../../src/index/build/tree-sitter-scheduler/paths.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'scheduler-paged-json-gzip', 'index-code');
await fs.rm(outDir, { recursive: true, force: true });
const paths = resolveTreeSitterSchedulerPaths(outDir);
await fs.mkdir(paths.resultsDir, { recursive: true });

const grammarKey = 'native:javascript';
const rows = [
  {
    schemaVersion: '1.1.0',
    virtualPath: '.poc-vfs/src/one.js#seg:one.js',
    grammarKey,
    segmentRef: 0,
    chunks: [{ start: 0, end: 4, name: 'one', kind: 'FunctionDeclaration' }]
  },
  {
    schemaVersion: '1.1.0',
    virtualPath: '.poc-vfs/src/two.js#seg:two.js',
    grammarKey,
    segmentRef: 0,
    chunks: [{ start: 0, end: 4, name: 'two', kind: 'FunctionDeclaration' }]
  }
];
const rowsJson = JSON.stringify(rows);
const pagePayload = {
  schemaVersion: '1.0.0',
  grammarKey,
  pageId: 0,
  codec: 'gzip',
  rowCount: rows.length,
  checksum: sha1(rowsJson).slice(0, 16),
  data: zlib.gzipSync(Buffer.from(rowsJson, 'utf8')).toString('base64')
};
const pageJson = JSON.stringify(pagePayload);
const pageBuffer = Buffer.from(pageJson, 'utf8');
const header = Buffer.allocUnsafe(4);
header.writeUInt32LE(pageBuffer.length, 0);
const totalBytes = pageBuffer.length + 4;
const resultsPath = paths.resultsPathForGrammarKey(grammarKey, 'binary-v1');
await fs.writeFile(resultsPath, Buffer.concat([header, pageBuffer]));
await fs.writeFile(
  paths.resultsPageIndexPathForGrammarKey(grammarKey),
  `${JSON.stringify({
    schemaVersion: '1.0.0',
    grammarKey,
    pageId: 0,
    offset: 0,
    bytes: totalBytes,
    rowCount: rows.length,
    codec: 'gzip',
    checksum: sha1(rowsJson).slice(0, 16)
  })}\n`,
  'utf8'
);

const index = new Map();
for (let i = 0; i < rows.length; i += 1) {
  const row = rows[i];
  index.set(row.virtualPath, {
    schemaVersion: '1.0.0',
    virtualPath: row.virtualPath,
    grammarKey,
    store: 'paged-json',
    format: 'page-v1',
    page: 0,
    row: i,
    checksum: sha1(JSON.stringify(row)).slice(0, 16)
  });
}

const lookup = createTreeSitterSchedulerLookup({ outDir, index });
try {
  const loaded = await lookup.loadRows(rows.map((row) => row.virtualPath));
  assert.equal(loaded.length, rows.length, 'loaded rows length mismatch');
  for (let i = 0; i < loaded.length; i += 1) {
    assert.ok(loaded[i], `expected row ${i}`);
    assert.equal(loaded[i].virtualPath, rows[i].virtualPath, `virtual path mismatch at ${i}`);
  }
  const retained = await lookup.loadChunks(rows[0].virtualPath, { consume: false });
  assert.ok(Array.isArray(retained) && retained.length === 1, 'expected paged chunk load');
  const retainedStats = lookup.stats();
  assert.ok(retainedStats.cacheEntries >= 1, 'expected row cache entry for non-consumed paged row');
  assert.ok(retainedStats.pageCacheEntries >= 1, 'expected page cache entry for non-consumed paged row');
  const consumed = await lookup.loadChunks(rows[0].virtualPath);
  assert.ok(Array.isArray(consumed) && consumed.length === 1, 'expected consumed paged chunk load');
  const consumedFirstStats = lookup.stats();
  assert.equal(
    consumedFirstStats.pageCacheEntries,
    1,
    'expected shared page cache to remain while sibling virtual paths are unconsumed'
  );
  const consumedSecond = await lookup.loadChunks(rows[1].virtualPath);
  assert.ok(Array.isArray(consumedSecond) && consumedSecond.length === 1, 'expected second consumed paged chunk load');
  const consumedStats = lookup.stats();
  assert.equal(consumedStats.cacheEntries, 0, 'expected consumed paged row to release row cache');
  assert.equal(consumedStats.pageCacheEntries, 0, 'expected consumed paged row to release page cache');
} finally {
  await lookup.close();
}

const originalReadFile = fs.readFile;
let emfileAttempts = 0;
const pageIndexPath = paths.resultsPageIndexPathForGrammarKey(grammarKey);
fs.readFile = async (...args) => {
  const [targetPath] = args;
  if (String(targetPath) === String(pageIndexPath) && emfileAttempts < 12) {
    emfileAttempts += 1;
    const err = new Error('too many open files');
    err.code = 'EMFILE';
    throw err;
  }
  return originalReadFile(...args);
};
try {
  const retryLookup = createTreeSitterSchedulerLookup({ outDir, index });
  try {
    const loaded = await retryLookup.loadRows(rows.map((row) => row.virtualPath));
    assert.equal(loaded.length, rows.length, 'expected paged lookup to recover after transient EMFILE');
  } finally {
    await retryLookup.close();
  }
} finally {
  fs.readFile = originalReadFile;
}
assert.equal(emfileAttempts, 12, 'expected transient EMFILE retries for paged index reads');

console.log('scheduler paged-json gzip test passed');
