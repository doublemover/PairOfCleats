#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  preloadIncrementalBundleVfsRows,
  updateBundlesWithChunks,
  writeIncrementalBundle
} from '../../../src/index/build/incremental.js';
import {
  readBundleFile,
  resolveBundleFormatFromName
} from '../../../src/shared/bundle-io.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'incremental-crossfile-prefetch-vfs');
const bundleDir = path.join(tempRoot, 'incremental', 'code', 'files');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });

const sharedStat = { size: 123, mtimeMs: 1700000000000 };
const manifest = { bundleFormat: 'json', files: {} };
const sourceRowsByFile = new Map([
  ['src/a.js', [{ virtualPath: '/vfs/src/a.js', languageId: 'javascript' }]],
  ['src/b.js', [{ virtualPath: '/vfs/src/b.js', languageId: 'javascript' }]]
]);

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

await updateBundlesWithChunks({
  enabled: true,
  manifest,
  bundleDir,
  bundleFormat: 'json',
  chunks: [
    { file: 'src/a.js', chunkId: 'a:new', text: 'updated a' },
    { file: 'src/b.js', chunkId: 'b:new', text: 'updated b' }
  ],
  fileRelations: new Map([
    ['src/a.js', { imports: ['./dep-a.js'] }],
    ['src/b.js', { imports: ['./dep-b.js'] }]
  ]),
  existingVfsManifestRowsByFile: prefetchedRowsByFile,
  log: () => {}
});

for (const [relKey, entry] of Object.entries(manifest.files)) {
  const bundlePath = path.join(bundleDir, entry.bundle);
  const loaded = await readBundleFile(bundlePath, {
    format: resolveBundleFormatFromName(entry.bundle, 'json')
  });
  assert.ok(loaded?.ok, `expected updated bundle for ${relKey}`);
  assert.deepEqual(
    loaded.bundle?.vfsManifestRows || null,
    sourceRowsByFile.get(relKey) || null,
    `expected VFS rows to be preserved for ${relKey}`
  );
}

console.log('incremental cross-file prefetch vfs rows test passed');
