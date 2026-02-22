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
  resolveBundleFormatFromName,
  resolveBundlePatchPath
} from '../../../src/shared/bundle-io.js';

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
const tempRoot = path.join(root, '.testCache', 'incremental-crossfile-bundle-patch-write');
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

const bundlePath = path.join(bundleDir, entry.bundle);
const before = await fs.stat(bundlePath);
await new Promise((resolve) => setTimeout(resolve, 25));

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
assert.equal(
  after.mtimeMs,
  before.mtimeMs,
  'expected JSON bundle base file to remain unchanged when patch write succeeds'
);

const patchPath = resolveBundlePatchPath(bundlePath);
assert.equal(await pathExists(patchPath), true, 'expected patch sidecar to be created');
const patchRaw = await fs.readFile(patchPath, 'utf8');
const patchLines = patchRaw.split(/\r?\n/).filter((line) => line.trim().length > 0);
assert.ok(patchLines.length >= 1, 'expected at least one patch operation');

const loaded = await readBundleFile(bundlePath, {
  format: resolveBundleFormatFromName(entry.bundle, 'json')
});
assert.equal(loaded?.ok, true, 'expected patched bundle to load');
assert.equal(loaded.bundle?.chunks?.[0]?.text, 'updated-a', 'expected patched first chunk text');
assert.equal(loaded.bundle?.chunks?.[2]?.chunkId, 'c', 'expected patched append chunk');
assert.deepEqual(
  loaded.bundle?.fileRelations || null,
  { imports: ['./dep-b.js'] },
  'expected patched bundle file relations'
);

await fs.appendFile(patchPath, '{"format":"broken"}\n', 'utf8');
const invalid = await readBundleFile(bundlePath, {
  format: resolveBundleFormatFromName(entry.bundle, 'json')
});
assert.equal(invalid?.ok, false, 'expected invalid patch sidecar to fail strict bundle reads');
assert.equal(invalid?.reason, 'invalid bundle patch', 'expected strict patch validation failure reason');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('incremental cross-file bundle patch write test passed');
