#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { createBundleLoader } from '../../../src/storage/sqlite/build/bundle-loader.js';
import { writeBundleFile, writeBundlePatch } from '../../../src/shared/bundle-io.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-bundle-loader-worker');
const bundleDir = path.join(tempRoot, 'bundles');
const relFile = 'src/example.js';
const bundleName = 'bundle-example.json';
const bundlePath = path.join(bundleDir, bundleName);
const workerPath = path.join(root, 'src', 'storage', 'sqlite', 'build', 'bundle-loader-worker.js');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(bundleDir, { recursive: true });

await writeBundleFile({
  bundlePath,
  format: 'json',
  bundle: {
    file: relFile,
    chunks: [{
      id: 0,
      file: relFile,
      start: 0,
      end: 10,
      tokens: ['alpha'],
      metaV2: {
        chunkId: 'chunk:0',
        file: relFile,
        range: { start: 0, end: 10 },
        lang: 'javascript',
        ext: '.js',
        relations: { calls: [{ targetChunkId: 'old' }] },
        segment: null
      }
    }]
  }
});

await writeBundlePatch({
  bundlePath,
  format: 'json',
  previousBundle: {
    file: relFile,
    chunks: [{
      id: 0,
      file: relFile,
      start: 0,
      end: 10,
      tokens: ['alpha'],
      metaV2: {
        chunkId: 'chunk:0',
        file: relFile,
        range: { start: 0, end: 10 },
        lang: 'javascript',
        ext: '.js',
        relations: { calls: [{ targetChunkId: 'old' }] },
        segment: null
      }
    }]
  },
  nextBundle: {
    file: relFile,
    chunks: [{
      id: 0,
      file: relFile,
      start: 0,
      end: 10,
      tokens: ['alpha'],
      metaV2: {
        chunkId: 'chunk:0',
        file: relFile,
        range: { start: 0, end: 10 },
        lang: 'javascript',
        ext: '.js',
        relations: { calls: [{ targetChunkId: 'new' }] },
        segment: null
      }
    }]
  }
});

const loader = createBundleLoader({ bundleThreads: 2, workerPath });
try {
  const loaded = await loader.loadBundle({
    bundleDir,
    file: relFile,
    entry: { bundles: [bundleName] }
  });
  assert.equal(loaded.ok, true, `expected bundle loader success, got: ${loaded.reason || 'unknown'}`);
  const firstShard = Array.isArray(loaded.bundleShards) ? loaded.bundleShards[0] : null;
  const targetChunkId = firstShard?.chunks?.[0]?.metaV2?.relations?.calls?.[0]?.targetChunkId || null;
  assert.equal(targetChunkId, 'new', 'expected worker loader to apply bundle patch sidecar');
} finally {
  await loader.close();
}

const directLoader = createBundleLoader({ bundleThreads: 1, workerPath });
try {
  const loaded = await directLoader.loadBundle({
    bundleDir,
    file: relFile,
    entry: { bundles: [bundleName] }
  });
  assert.equal(loaded.ok, true, `expected direct bundle loader success, got: ${loaded.reason || 'unknown'}`);
  assert.equal(Array.isArray(loaded.bundleShards), true, 'expected direct loader to return bundleShards');
  assert.equal(loaded.bundleShards.length, 1, 'expected direct loader to expose one shard');

  const invalidEntry = await directLoader.loadBundle({
    bundleDir,
    file: relFile,
    entry: { bundles: ['nested/invalid.json'] }
  });
  assert.equal(invalidEntry.ok, false, 'expected invalid manifest bundle entry to fail closed');
  assert.match(
    invalidEntry.reason || '',
    /path separators/i,
    'expected invalid bundle-name reason to be preserved'
  );
} finally {
  await directLoader.close();
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

console.log('sqlite bundle loader worker patch parity ok');
