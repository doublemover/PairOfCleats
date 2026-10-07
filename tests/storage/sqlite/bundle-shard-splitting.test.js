#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import {
  buildBundleDatabase,
  loadSqliteBundleDatabase,
  prepareBundleBuildFixture
} from './helpers/bundle-fixture.js';

const Database = await loadSqliteBundleDatabase('sqlite bundle shard tests');
const { tempRoot, bundleDir, dbPath } = await prepareBundleBuildFixture({
  label: 'sqlite-bundle-shard-splitting',
  dbName: 'index-code.db'
});

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

const result = await buildBundleDatabase({
  Database,
  dbPath,
  mode: 'code',
  manifest: { files: { [relKey]: manifestEntry } },
  bundleDir
});

assert.equal(result.reason || null, null, `expected no bundle failure, got: ${result.reason || 'none'}`);
assert.equal(result.count, chunkCount, `expected ${chunkCount} indexed chunks, got ${result.count}`);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('sqlite bundle shard splitting test passed');
