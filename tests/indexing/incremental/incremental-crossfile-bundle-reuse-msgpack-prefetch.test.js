#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { updateBundlesWithChunks, writeIncrementalBundle } from '../../../src/index/build/incremental.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({
  testing: '1',
  extraEnv: {
    PAIROFCLEATS_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY: '1'
  }
});

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'incremental-crossfile-bundle-reuse-msgpack-prefetch');
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
  bundleFormat: 'msgpack'
});
assert.ok(entry, 'expected initial msgpack bundle write');

const manifest = {
  bundleFormat: 'msgpack',
  files: {
    [relKey]: entry
  }
};

const logs = [];
await updateBundlesWithChunks({
  enabled: true,
  manifest,
  bundleDir,
  bundleFormat: 'msgpack',
  chunks: [{ file: relKey, chunkId: 'a:1', text: 'seed text' }],
  fileRelations: new Map([[relKey, { imports: ['./dep.js'] }]]),
  existingVfsManifestRowsByFile: new Map([[relKey, vfsManifestRows]]),
  log: (line) => logs.push(String(line || ''))
});

assert.ok(
  logs.some((line) => line.includes('reused 1')),
  `expected msgpack bundle reuse when prefetch rows are present: ${JSON.stringify(logs)}`
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('incremental cross-file msgpack prefetch reuse test passed');
