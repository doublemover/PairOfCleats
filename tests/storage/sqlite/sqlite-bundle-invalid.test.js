#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-bundle-invalid');
const bundleDir = path.join(tempRoot, 'bundles');
const dbPath = path.join(tempRoot, 'index-code.db');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(bundleDir, { recursive: true });

const bundleName = 'bad-bundle.json';
const bundlePath = path.join(bundleDir, bundleName);
await fsPromises.writeFile(bundlePath, JSON.stringify({ files: [] }), 'utf8');

const result = await buildDatabaseFromBundles({
  Database,
  outPath: dbPath,
  mode: 'code',
  incrementalData: {
    bundleDir,
    manifest: {
      files: {
        'src/bad.js': { bundles: [bundleName], mtimeMs: 1, size: 0 }
      }
    }
  },
  envConfig: { bundleThreads: 1 },
  threadLimits: { fileConcurrency: 1 },
  emitOutput: false,
  validateMode: 'off',
  vectorConfig: { enabled: false },
  modelConfig: { id: 'test' },
  workerPath: null,
  logger: null
});

assert.equal(result.count, 0, 'expected bundle build to skip invalid bundle');
assert.ok(
  result.reason && result.reason.includes('invalid bundle'),
  `expected invalid bundle reason, got ${result.reason}`
);

console.log('sqlite bundle invalid test passed');

