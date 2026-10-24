#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { readJsonFileSafe, readJsonFileSyncSafe } from '../../../src/shared/file-read.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// Actual files preserve the parse/report/fallback contract after descriptor
// ownership replaces the obsolete readFile monkeypatch boundary. UNVALIDATED.
const root = await makeTempDir('poc-json-safe-report-');
const syncFile = path.join(root, 'sync.json'), asyncFile = path.join(root, 'async.json');
await fsPromises.writeFile(syncFile, '{broken'); await fsPromises.writeFile(asyncFile, '{oops');

try {
  const syncErrors = [];
  const syncFallback = { ok: false };
  const syncOut = readJsonFileSyncSafe(syncFile, {
    fallback: syncFallback,
    maxBytes: 1024,
    onError: (info) => syncErrors.push(info)
  });
  assert.equal(syncOut, syncFallback);
  assert.equal(syncErrors.length, 1, 'expected exactly one sync parse error');
  assert.equal(syncErrors[0]?.phase, 'parse');
  assert.equal(syncErrors[0]?.sync, true);
  assert.equal(syncErrors[0]?.path, syncFile);

  const asyncErrors = [];
  const asyncFallback = { ok: false };
  const asyncOut = await readJsonFileSafe(asyncFile, {
    fallback: asyncFallback,
    maxBytes: 1024,
    onError: (info) => asyncErrors.push(info)
  });
  assert.equal(asyncOut, asyncFallback);
  assert.equal(asyncErrors.length, 1, 'expected exactly one async parse error');
  assert.equal(asyncErrors[0]?.phase, 'parse');
  assert.equal(asyncErrors[0]?.sync, false);
  assert.equal(asyncErrors[0]?.path, asyncFile);

  const sentinelFallback = Symbol('parse-failed');
  const syncSentinelOut = readJsonFileSyncSafe(syncFile, sentinelFallback);
  assert.equal(syncSentinelOut, sentinelFallback, 'expected legacy sync fallback arg to be preserved');

  const asyncSentinelOut = await readJsonFileSafe(asyncFile, sentinelFallback);
  assert.equal(asyncSentinelOut, sentinelFallback, 'expected legacy async fallback arg to be preserved');

  const syncNullOut = readJsonFileSyncSafe(syncFile, null);
  assert.equal(syncNullOut, null, 'expected explicit null fallback arg to remain valid');

  const asyncNullOut = await readJsonFileSafe(asyncFile, null);
  assert.equal(asyncNullOut, null, 'expected explicit null async fallback arg to remain valid');
} finally {
  await rmDirRecursive(root);
}

console.log('read json safe on-error test passed');
