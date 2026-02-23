#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({
  testing: '1',
  extraEnv: {
    PAIROFCLEATS_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY: '1'
  }
});

const { updateBundlesWithChunks } = await import('../../../src/index/build/incremental.js');

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'incremental-crossfile-hot-cold-priority');
const bundleDir = path.join(tempRoot, 'incremental', 'code', 'files');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });

const now = Date.now();
const manifest = {
  bundleFormat: 'json',
  files: {
    'src/cold.js': {
      hash: 'hash:cold',
      mtimeMs: now - (45 * 60 * 1000),
      size: 10,
      bundle: 'cold.json'
    },
    'src/hot-older.js': {
      hash: 'hash:hot-older',
      mtimeMs: now - (2 * 60 * 1000),
      size: 11,
      bundle: 'hot-older.json'
    },
    'src/hot-newer.js': {
      hash: 'hash:hot-newer',
      mtimeMs: now - 30_000,
      size: 12,
      bundle: 'hot-newer.json'
    }
  }
};

const expectedProcessOrder = [
  'src/hot-newer.js',
  'src/hot-older.js',
  'src/cold.js'
];
const relationByFile = new Map(expectedProcessOrder.map((file) => [file, { imports: [] }]));
const observedProcessOrder = [];
const fileRelations = {
  get(file) {
    if (relationByFile.has(file)) observedProcessOrder.push(file);
    return relationByFile.get(file) || null;
  }
};

await updateBundlesWithChunks({
  enabled: true,
  manifest,
  bundleDir,
  bundleFormat: 'json',
  chunks: [
    { file: 'src/cold.js', chunkId: 'cold:new', text: 'cold update' },
    { file: 'src/hot-older.js', chunkId: 'hot-older:new', text: 'hot older update' },
    { file: 'src/hot-newer.js', chunkId: 'hot-newer:new', text: 'hot newer update' }
  ],
  fileRelations,
  log: () => {}
});

assert.deepEqual(
  observedProcessOrder,
  expectedProcessOrder,
  'expected cross-file bundle updates to process hot files before cold files'
);

for (const [file, entry] of Object.entries(manifest.files)) {
  const bundlePath = path.join(bundleDir, entry.bundle);
  const rawBundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
  assert.equal(rawBundle.file, file, `expected written bundle for ${file}`);
}

console.log('incremental cross-file hot/cold update priority test passed');
