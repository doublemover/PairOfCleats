#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBundleFile } from '../../../src/shared/bundle-io.js';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = path.join(ROOT, 'tests', '.cache', 'sqlite-bundle-dims-mismatch');
const bundleDir = path.join(tempRoot, 'bundles');
const dbPath = path.join(tempRoot, 'index-code.db');

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.error('better-sqlite3 is required for sqlite bundle tests.');
  process.exit(1);
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(bundleDir, { recursive: true });

const bundleA = 'bundle-a.json';
const bundleB = 'bundle-b.json';
await writeBundleFile({
  bundlePath: path.join(bundleDir, bundleA),
  format: 'json',
  bundle: {
    chunks: [
      {
        file: 'a.js',
        start: 0,
        end: 1,
        tokens: ['a'],
        embedding: [0.1, 0.2]
      }
    ]
  }
});
await writeBundleFile({
  bundlePath: path.join(bundleDir, bundleB),
  format: 'json',
  bundle: {
    chunks: [
      {
        file: 'b.js',
        start: 0,
        end: 1,
        tokens: ['b'],
        embedding: [0.1, 0.2, 0.3]
      }
    ]
  }
});

const manifest = {
  files: {
    'a.js': { bundle: bundleA, mtimeMs: 1, size: 1, hash: 'a' },
    'b.js': { bundle: bundleB, mtimeMs: 2, size: 1, hash: 'b' }
  }
};

const result = await buildDatabaseFromBundles({
  Database,
  outPath: dbPath,
  mode: 'code',
  incrementalData: { manifest, bundleDir },
  envConfig: { bundleThreads: 1 },
  threadLimits: { fileConcurrency: 1 },
  emitOutput: false,
  validateMode: 'off',
  vectorConfig: { enabled: false },
  modelConfig: { id: null },
  workerPath: null
});

if (result.count !== 0 || !result.reason || !result.reason.includes('Dense vector dims mismatch')) {
  console.error(`Expected dims mismatch failure, got: ${JSON.stringify(result)}`);
  process.exit(1);
}

console.log('SQLite bundle dims mismatch hard-fail ok.');
