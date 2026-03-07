#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import {
  pruneIncrementalManifest,
  updateBundlesWithChunks,
  writeIncrementalBundle
} from '../../../src/index/build/incremental.js';

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
const tempRoot = path.join(root, '.testLogs', 'incremental-writeback-manifest-durability');
const bundleDir = path.join(tempRoot, 'incremental', 'code', 'files');
const manifestPath = path.join(tempRoot, 'incremental', 'code', 'manifest.json');
const invalidManifestPath = path.join(tempRoot, 'invalid-manifest-dir');

const baseStat = { size: 321, mtimeMs: 1_700_000_000_000 };

const writeSeedEntry = async ({ relKey, fileHash, fileChunks }) => writeIncrementalBundle({
  enabled: true,
  bundleDir,
  relKey,
  fileStat: baseStat,
  fileHash,
  fileChunks,
  fileRelations: { imports: [] },
  vfsManifestRows: null,
  bundleFormat: 'json'
});

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });
await fs.mkdir(invalidManifestPath, { recursive: true });

const pruneRel = 'src/prune-target.js';
const pruneEntryFail = await writeSeedEntry({
  relKey: pruneRel,
  fileHash: 'hash:prune:fail',
  fileChunks: [{ file: pruneRel, chunkId: 'prune-fail', text: 'seed' }]
});
assert.ok(pruneEntryFail?.bundles?.length, 'expected prune seed bundle');
const pruneBundleFail = path.join(bundleDir, pruneEntryFail.bundles[0]);
const pruneManifestFail = {
  bundleFormat: 'json',
  files: {
    [pruneRel]: pruneEntryFail
  }
};

await pruneIncrementalManifest({
  enabled: true,
  manifest: pruneManifestFail,
  manifestPath: invalidManifestPath,
  bundleDir,
  seenFiles: new Set()
});
assert.equal(
  await pathExists(pruneBundleFail),
  true,
  'expected failed manifest commit to skip shard GC'
);

const pruneEntryOk = await writeSeedEntry({
  relKey: pruneRel,
  fileHash: 'hash:prune:ok',
  fileChunks: [{ file: pruneRel, chunkId: 'prune-ok', text: 'seed' }]
});
assert.ok(pruneEntryOk?.bundles?.length, 'expected prune success seed bundle');
const pruneBundleOk = path.join(bundleDir, pruneEntryOk.bundles[0]);
const pruneManifestOk = {
  bundleFormat: 'json',
  files: {
    [pruneRel]: pruneEntryOk
  }
};

await pruneIncrementalManifest({
  enabled: true,
  manifest: pruneManifestOk,
  manifestPath,
  bundleDir,
  seenFiles: new Set()
});
assert.equal(
  await pathExists(pruneBundleOk),
  false,
  'expected successful manifest commit to allow shard GC'
);

const persistedAfterPrune = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
assert.equal(
  Object.prototype.hasOwnProperty.call(persistedAfterPrune?.files || {}, pruneRel),
  false,
  'expected persisted manifest to drop pruned file entry'
);

const updateRel = 'src/update-target.js';
const largeText = 'x'.repeat(6 * 1024 * 1024);
const updateSeedEntry = await writeSeedEntry({
  relKey: updateRel,
  fileHash: 'hash:update:seed',
  fileChunks: [
    { file: updateRel, chunkId: 'a', text: largeText },
    { file: updateRel, chunkId: 'b', text: largeText },
    { file: updateRel, chunkId: 'c', text: largeText }
  ]
});
assert.ok((updateSeedEntry?.bundles?.length || 0) > 1, 'expected multi-shard seed bundle');

const updateManifest = {
  bundleFormat: 'json',
  files: {
    [updateRel]: updateSeedEntry
  }
};
const previousBundleNames = updateSeedEntry.bundles.slice();
const updateChunks = [
  { file: updateRel, chunkId: 'small', text: 'small update payload' }
];
const updateRelations = new Map([[updateRel, { imports: ['./dep.js'] }]]);

await updateBundlesWithChunks({
  enabled: true,
  manifest: updateManifest,
  manifestPath: invalidManifestPath,
  bundleDir,
  bundleFormat: 'json',
  chunks: updateChunks,
  fileRelations: updateRelations,
  log: () => {}
});

const currentBundleNames = updateManifest.files[updateRel]?.bundles || [];
const staleBundleNames = previousBundleNames.filter((name) => !currentBundleNames.includes(name));
assert.ok(staleBundleNames.length > 0, 'expected shard downsize to create stale bundle candidates');
for (const staleName of staleBundleNames) {
  assert.equal(
    await pathExists(path.join(bundleDir, staleName)),
    true,
    `expected stale shard ${staleName} to remain when manifest write fails`
  );
}

await updateBundlesWithChunks({
  enabled: true,
  manifest: updateManifest,
  manifestPath,
  bundleDir,
  bundleFormat: 'json',
  chunks: updateChunks,
  fileRelations: updateRelations,
  log: () => {}
});

for (const staleName of staleBundleNames) {
  assert.equal(
    await pathExists(path.join(bundleDir, staleName)),
    false,
    `expected stale shard ${staleName} to be GC'd after successful manifest commit`
  );
}

const persistedAfterUpdate = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const persistedBundles = persistedAfterUpdate?.files?.[updateRel]?.bundles || [];
assert.deepEqual(
  persistedBundles.slice().sort(),
  currentBundleNames.slice().sort(),
  'expected persisted manifest to reference active shard set after update'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('incremental writeback manifest durability test passed');
