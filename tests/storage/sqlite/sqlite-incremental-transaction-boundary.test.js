#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { writeBundleFile } from '../../../src/shared/bundle-io.js';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';
import { incrementalUpdateDatabase } from '../../../src/storage/sqlite/build/incremental-update.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-incremental-transaction-boundary');
const bundleDir = path.join(tempRoot, 'bundles');
const outPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });

const files = Array.from({ length: 4 }, (_, i) => `src/file-${i}.js`);
const chunksPerFile = 3;

const buildChunks = (file, suffix) => {
  const chunks = [];
  for (let i = 0; i < chunksPerFile; i += 1) {
    chunks.push({
      file,
      start: i * 10,
      end: i * 10 + 5,
      startLine: i + 1,
      endLine: i + 1,
      kind: 'code',
      name: `fn${suffix}-${i}`,
      tokens: [`tok-${suffix}`, `tok-${i}`]
    });
  }
  return chunks;
};

const manifest = { files: {} };
for (let i = 0; i < files.length; i += 1) {
  const file = files[i];
  const bundleName = `bundle-${i}.json`;
  await writeBundleFile({
    bundlePath: path.join(bundleDir, bundleName),
    bundle: { chunks: buildChunks(file, `v1-${i}`) },
    format: 'json'
  });
  manifest.files[file] = {
    hash: `hash-${i}`,
    mtimeMs: 1000 + i,
    size: 10 + i,
    bundle: bundleName
  };
}

const envConfig = { bundleThreads: 1 };
const threadLimits = { fileConcurrency: 1 };
await buildDatabaseFromBundles({
  Database,
  outPath,
  mode: 'code',
  incrementalData: { manifest, bundleDir },
  envConfig,
  threadLimits,
  emitOutput: false,
  validateMode: 'off',
  vectorConfig: { enabled: false },
  modelConfig: { id: null }
});

if (!fsSync.existsSync(outPath)) {
  console.error('Expected sqlite DB to be created before incremental update.');
  process.exit(1);
}

const updatedManifest = { files: { ...manifest.files } };
const changedFile = files[1];
const changedBundleName = 'bundle-changed.json';
await writeBundleFile({
  bundlePath: path.join(bundleDir, changedBundleName),
  bundle: { chunks: buildChunks(changedFile, 'v2') },
  format: 'json'
});
updatedManifest.files[changedFile] = {
  ...updatedManifest.files[changedFile],
  hash: 'hash-changed',
  mtimeMs: 9999,
  bundle: changedBundleName
};

const stats = {};
const updateResult = await incrementalUpdateDatabase({
  Database,
  outPath,
  mode: 'code',
  incrementalData: { manifest: updatedManifest, bundleDir },
  modelConfig: { id: null },
  vectorConfig: { enabled: false },
  emitOutput: false,
  validateMode: 'off',
  stats
});

if (!updateResult.used) {
  console.error(`Incremental update skipped: ${updateResult.reason || 'unknown reason'}`);
  process.exit(1);
}
assert.ok(stats.transactionPhases?.deletes, 'expected delete transaction phase to run');
assert.ok(stats.transactionPhases?.inserts, 'expected insert transaction phase to run');

console.log('sqlite incremental transaction boundary test passed');
