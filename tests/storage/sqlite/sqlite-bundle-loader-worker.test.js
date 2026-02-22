#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { createBundleLoader } from '../../../src/storage/sqlite/build/bundle-loader.js';
import { writeBundleFile, writeBundlePatch } from '../../../src/shared/bundle-io.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-bundle-loader-worker');
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
    entry: { bundle: bundleName }
  });
  assert.equal(loaded.ok, true, `expected bundle loader success, got: ${loaded.reason || 'unknown'}`);
  const targetChunkId = loaded.bundle?.chunks?.[0]?.metaV2?.relations?.calls?.[0]?.targetChunkId || null;
  assert.equal(targetChunkId, 'new', 'expected worker loader to apply bundle patch sidecar');
} finally {
  await loader.close();
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

console.log('sqlite bundle loader worker patch parity ok');
