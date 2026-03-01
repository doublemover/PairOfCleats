#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { updateBundlesWithChunks, writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { sleep } from '../../../src/shared/sleep.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({
  testing: '1',
  extraEnv: {
    PAIROFCLEATS_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY: '1'
  }
});

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'incremental-crossfile-bundle-reuse');
const bundleDir = path.join(tempRoot, 'incremental', 'code', 'files');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });

const relKey = 'src/a.js';
const fileStat = { mtimeMs: Date.now(), size: 128 };
const fileChunks = [{ file: relKey, chunkId: 'a:1', text: 'seed text' }];
const fileRelations = { imports: ['./dep.js'] };
const vfsManifestRows = [{ virtualPath: '/vfs/src/a.js', languageId: 'javascript' }];

const entry = await writeIncrementalBundle({
  enabled: true,
  bundleDir,
  relKey,
  fileStat,
  fileHash: 'hash:a',
  fileChunks,
  fileRelations,
  vfsManifestRows,
  bundleFormat: 'json'
});
assert.ok(entry, 'expected initial bundle write');

const manifest = {
  bundleFormat: 'json',
  files: {
    [relKey]: entry
  }
};

const bundleName = entry.bundles?.[0];
assert.ok(bundleName, 'expected bundle shard name');
const bundlePath = path.join(bundleDir, bundleName);
const before = await fs.stat(bundlePath);
await sleep(25);

const logs = [];
await updateBundlesWithChunks({
  enabled: true,
  manifest,
  bundleDir,
  bundleFormat: 'json',
  chunks: [{ file: relKey, chunkId: 'a:1', text: 'seed text' }],
  fileRelations: new Map([[relKey, { imports: ['./dep.js'] }]]),
  existingVfsManifestRowsByFile: new Map([[relKey, vfsManifestRows]]),
  log: (line) => logs.push(String(line || ''))
});

const after = await fs.stat(bundlePath);
assert.equal(
  after.mtimeMs,
  before.mtimeMs,
  'expected unchanged bundle to be reused without rewrite'
);
assert.ok(
  logs.some((line) => line.includes('reused 1')),
  'expected update log to report bundle reuse'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('incremental cross-file bundle reuse test passed');
