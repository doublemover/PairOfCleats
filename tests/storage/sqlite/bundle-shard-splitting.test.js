#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.error('better-sqlite3 is required for sqlite bundle shard tests.');
  process.exit(1);
}

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-bundle-shard-splitting');
const bundleDir = path.join(tempRoot, 'bundles');
const dbPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });

const relKey = 'src/very-large-file.js';
const chunkCount = 24;
const chunkText = 'x'.repeat(1024 * 1024);
const chunks = Array.from({ length: chunkCount }, (_, i) => ({
  file: relKey,
  start: i * 10,
  end: i * 10 + 5,
  startLine: i + 1,
  endLine: i + 1,
  ext: '.js',
  kind: 'code',
  tokens: [`tok-${i}`],
  text: chunkText
}));

const manifestEntry = await writeIncrementalBundle({
  enabled: true,
  bundleDir,
  relKey,
  fileStat: { mtimeMs: Date.now(), size: chunkText.length * chunkCount },
  fileHash: 'hash:large',
  fileChunks: chunks,
  fileRelations: { imports: [] },
  vfsManifestRows: [],
  bundleFormat: 'json'
});

assert.ok(manifestEntry, 'expected manifest entry from incremental shard write');
assert.ok(Array.isArray(manifestEntry.bundles), 'expected shard bundle names');
assert.ok(manifestEntry.bundles.length > 1, 'expected large bundle payload to be sharded');

for (const bundleName of manifestEntry.bundles) {
  const stat = await fs.stat(path.join(bundleDir, bundleName));
  assert.ok(
    Number(stat?.size) < (256 * 1024 * 1024),
    `expected shard ${bundleName} below hard read cap`
  );
}

const manifest = {
  files: {
    [relKey]: manifestEntry
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

assert.equal(result.reason || null, null, `expected no bundle failure, got: ${result.reason || 'none'}`);
assert.equal(result.count, chunkCount, `expected ${chunkCount} indexed chunks, got ${result.count}`);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('sqlite bundle shard splitting test passed');
