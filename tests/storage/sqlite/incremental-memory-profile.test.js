#!/usr/bin/env node
import assert from 'node:assert/strict';
import { incrementalUpdateDatabase } from '../../../src/storage/sqlite/build/incremental-update.js';

import {
  addChangedBundle,
  setupIncrementalBundleDatabase
} from './helpers/incremental-bundle-db-fixture.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const chunksPerFile = 4;
const {
  bundleDir,
  files,
  manifest,
  outPath
} = await setupIncrementalBundleDatabase({
  Database,
  name: 'sqlite-incremental-memory-profile',
  fileCount: 6,
  chunksPerFile
});

const { updatedManifest } = await addChangedBundle({
  bundleDir,
  chunksPerFile,
  files,
  manifest,
  changedFileIndex: 2
});

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
const totalChunks = files.length * chunksPerFile;
assert.equal(stats.existingChunkRows, chunksPerFile, 'expected only changed file chunks to be loaded');
assert.ok(stats.existingChunkRows < totalChunks, 'expected subset load of existing chunk ids');

console.log('sqlite incremental memory profile test passed');
