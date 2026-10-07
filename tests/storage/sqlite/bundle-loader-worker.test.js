#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { createBundleLoader } from '../../../src/storage/sqlite/build/bundle-loader.js';
import {
  writeBundleFile,
  writeBundlePatch
} from '../../../src/shared/bundle-io.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-bundle-loader-worker');
const bundleDir = path.join(tempRoot, 'bundles');
const relFile = 'src/example.js';
const bundleName = 'bundle-example.json';
const bundlePath = path.join(bundleDir, bundleName);
const workerPath = path.join(root, 'src', 'storage', 'sqlite', 'build', 'bundle-loader-worker.js');

const createBundleChunk = ({ targetChunkId }) => ({
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
    relations: { calls: [{ targetChunkId }] },
    segment: null
  }
});

const createBundle = (targetChunkId) => ({
  file: relFile,
  chunks: [createBundleChunk({ targetChunkId })]
});

const loadExampleBundle = (loader, bundles = [bundleName]) => loader.loadBundle({
  bundleDir,
  file: relFile,
  entry: { bundles }
});

const assertLoaded = (loaded, message) => {
  assert.equal(loaded.ok, true, `${message}, got: ${loaded.reason || 'unknown'}`);
};

const closeLoaderIdempotently = async (loader) => {
  await Promise.all([loader.close(), loader.close()]);
  await loader.close();
};

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(bundleDir, { recursive: true });

await writeBundleFile({
  bundlePath,
  format: 'json',
  bundle: createBundle('old')
});

await writeBundlePatch({
  bundlePath,
  format: 'json',
  previousBundle: createBundle('old'),
  nextBundle: createBundle('new')
});

const loader = createBundleLoader({ bundleThreads: 2, workerPath });
try {
  const loaded = await loadExampleBundle(loader);
  assertLoaded(loaded, 'expected bundle loader success');
  const firstShard = Array.isArray(loaded.bundleShards) ? loaded.bundleShards[0] : null;
  const targetChunkId = firstShard?.chunks?.[0]?.metaV2?.relations?.calls?.[0]?.targetChunkId || null;
  assert.equal(targetChunkId, 'new', 'expected worker loader to apply bundle patch sidecar');
} finally {
  await closeLoaderIdempotently(loader);
}

const directLoader = createBundleLoader({ bundleThreads: 1, workerPath });
try {
  const loaded = await loadExampleBundle(directLoader);
  assertLoaded(loaded, 'expected direct bundle loader success');
  assert.equal(Array.isArray(loaded.bundleShards), true, 'expected direct loader to return bundleShards');
  assert.equal(loaded.bundleShards.length, 1, 'expected direct loader to expose one shard');

  const invalidEntry = await loadExampleBundle(directLoader, ['nested/invalid.json']);
  assert.equal(invalidEntry.ok, false, 'expected invalid manifest bundle entry to fail closed');
  assert.match(
    invalidEntry.reason || '',
    /path separators/i,
    'expected invalid bundle-name reason to be preserved'
  );
} finally {
  await closeLoaderIdempotently(directLoader);
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

console.log('sqlite bundle loader worker patch parity ok');
