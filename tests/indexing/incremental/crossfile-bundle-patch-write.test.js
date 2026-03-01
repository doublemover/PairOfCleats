#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import {
  updateBundlesWithChunks,
  writeIncrementalBundle
} from '../../../src/index/build/incremental.js';
import {
  readBundleFile,
  resolveBundleFormatFromName
} from '../../../src/shared/bundle-io.js';
import { sleep } from '../../../src/shared/sleep.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({
  testing: '1',
  extraEnv: {
    PAIROFCLEATS_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY: '1'
  }
});

const pathExists = async (targetPath) => {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
};

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'incremental-crossfile-bundle-patch-write');
const bundleDir = path.join(tempRoot, 'incremental', 'code', 'files');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });

const relKey = 'src/patch-target.js';
const fileStat = { mtimeMs: 1700000000000, size: 222 };
const manifestRows = [{ virtualPath: '/vfs/src/patch-target.js', languageId: 'javascript' }];
const seedChunks = [
  { file: relKey, chunkId: 'a', text: 'seed-a' },
  { file: relKey, chunkId: 'b', text: 'seed-b' }
];
const entry = await writeIncrementalBundle({
  enabled: true,
  bundleDir,
  relKey,
  fileStat,
  fileHash: 'hash:seed',
  fileChunks: seedChunks,
  fileRelations: { imports: ['./dep-a.js'] },
  vfsManifestRows: manifestRows,
  bundleFormat: 'json'
});
assert.ok(entry, 'expected seeded incremental bundle entry');

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

await updateBundlesWithChunks({
  enabled: true,
  manifest,
  bundleDir,
  bundleFormat: 'json',
  chunks: [
    { file: relKey, chunkId: 'a', text: 'updated-a' },
    { file: relKey, chunkId: 'b', text: 'seed-b' },
    { file: relKey, chunkId: 'c', text: 'added-c' }
  ],
  fileRelations: new Map([[relKey, { imports: ['./dep-b.js'] }]]),
  log: () => {}
});

const after = await fs.stat(bundlePath);
assert.ok(after.mtimeMs > before.mtimeMs, 'expected bundle rewrite to update mtime');

const loaded = await readBundleFile(bundlePath, {
  format: resolveBundleFormatFromName(bundleName, 'json')
});
assert.equal(loaded?.ok, true, 'expected patched bundle to load');
assert.equal(loaded.bundle?.chunks?.[0]?.text, 'updated-a', 'expected patched first chunk text');
assert.equal(loaded.bundle?.chunks?.[2]?.chunkId, 'c', 'expected patched append chunk');
assert.deepEqual(
  loaded.bundle?.fileRelations || null,
  { imports: ['./dep-b.js'] },
  'expected patched bundle file relations'
);
assert.equal(
  await pathExists(`${bundlePath}.patch.jsonl`),
  false,
  'expected shard rewrite path to avoid json patch sidecars'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('incremental cross-file bundle patch write test passed');
