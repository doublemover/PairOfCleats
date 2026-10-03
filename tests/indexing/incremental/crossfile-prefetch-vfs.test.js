#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  preloadIncrementalBundleVfsRows,
  updateBundlesWithChunks,
  writeIncrementalBundle
} from '../../../src/index/build/incremental.js';
import { resolveBundleFormatFromName } from '../../../src/shared/bundle-io-paths.js';
import { readBundleFile } from '../../../src/shared/bundle-io.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'incremental-crossfile-prefetch-vfs');
const bundleDir = path.join(tempRoot, 'incremental', 'code', 'files');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });

const sharedStat = { size: 123, mtimeMs: 1700000000000 };
const manifest = { bundleFormat: 'json', files: {} };
const sourceRowsByFile = new Map([
  ['src/a.js', [{ virtualPath: '/vfs/src/a.js', languageId: 'javascript' }]],
  ['src/b.js', [{ virtualPath: '/vfs/src/b.js', languageId: 'javascript' }]]
]);

const seedBundles = async () => {
  for (const [relKey, vfsRows] of sourceRowsByFile.entries()) {
    const entry = await writeIncrementalBundle({
      enabled: true,
      bundleDir,
      relKey,
      fileStat: sharedStat,
      fileHash: `hash:${relKey}`,
      fileChunks: [{ file: relKey, chunkId: `${relKey}:seed`, text: 'seed' }],
      fileRelations: { imports: [] },
      vfsManifestRows: vfsRows,
      bundleFormat: 'json'
    });
    assert.ok(entry, `expected manifest entry for ${relKey}`);
    manifest.files[relKey] = entry;
  }
};

await seedBundles();

const createUpdatedChunks = (suffix) => [
  { file: 'src/a.js', chunkId: `a:${suffix}`, text: `updated a ${suffix}` },
  { file: 'src/b.js', chunkId: `b:${suffix}`, text: `updated b ${suffix}` }
];

const createFileRelations = () => new Map([
  ['src/a.js', { imports: ['./dep-a.js'] }],
  ['src/b.js', { imports: ['./dep-b.js'] }]
]);

const assertBundlesPreserveVfsRows = async (message) => {
  for (const [relKey, entry] of Object.entries(manifest.files)) {
    const bundleName = entry.bundles?.[0];
    assert.ok(bundleName, `expected bundle name for ${relKey}`);
    const bundlePath = path.join(bundleDir, bundleName);
    const loaded = await readBundleFile(bundlePath, {
      format: resolveBundleFormatFromName(bundleName, 'json')
    });
    assert.ok(loaded?.ok, `expected ${message} bundle for ${relKey}`);
    assert.deepEqual(
      loaded.bundle?.vfsManifestRows || null,
      sourceRowsByFile.get(relKey) || null,
      `expected ${message} to preserve VFS rows for ${relKey}`
    );
  }
};

const updateBundlesAndAssertVfsRows = async ({
  suffix,
  existingVfsManifestRowsByFile,
  message
}) => {
  await updateBundlesWithChunks({
    enabled: true,
    manifest,
    bundleDir,
    bundleFormat: 'json',
    chunks: createUpdatedChunks(suffix),
    fileRelations: createFileRelations(),
    existingVfsManifestRowsByFile,
    log: () => {}
  });

  await assertBundlesPreserveVfsRows(message);
};

const prefetchedRowsByFile = await preloadIncrementalBundleVfsRows({
  enabled: true,
  manifest,
  bundleDir,
  bundleFormat: 'json',
  concurrency: 2
});
assert.ok(prefetchedRowsByFile instanceof Map, 'expected prefetched rows map');

await fs.rm(bundleDir, { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });

await updateBundlesAndAssertVfsRows({
  suffix: 'new',
  existingVfsManifestRowsByFile: prefetchedRowsByFile,
  message: 'updated'
});

await fs.rm(bundleDir, { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });
await seedBundles();

const partialPrefetchedRows = new Map([
  ['src/a.js', prefetchedRowsByFile.get('src/a.js') || null]
]);

await updateBundlesAndAssertVfsRows({
  suffix: 'new2',
  existingVfsManifestRowsByFile: partialPrefetchedRows,
  message: 'partial prefetch fallback'
});

console.log('incremental cross-file prefetch vfs rows test passed');
