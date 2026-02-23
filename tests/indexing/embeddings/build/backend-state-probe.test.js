#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { resolvePublishedBackendStates } from '../../../../tools/build/embeddings/runner/backend-state.js';
import { resolveHnswPaths, resolveHnswTarget } from '../../../../src/shared/hnsw.js';
import { resolveLanceDbPaths, resolveLanceDbTarget } from '../../../../src/shared/lancedb.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

applyTestEnv();
const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'embeddings-backend-state-probe');
const indexDir = path.join(tempRoot, 'index-code');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const mode = 'code';
const denseVectorMode = 'merged';
const hnswTarget = resolveHnswTarget(mode, denseVectorMode);
const hnswPaths = resolveHnswPaths(indexDir, hnswTarget);
await fs.mkdir(path.dirname(hnswPaths.metaPath), { recursive: true });
await fs.writeFile(hnswPaths.metaPath, JSON.stringify({ dims: 256, count: 7 }));
await fs.writeFile(hnswPaths.indexPath, 'hnsw');

const lancePaths = resolveLanceDbPaths(indexDir);
const lanceTarget = resolveLanceDbTarget(mode, denseVectorMode);
const lanceTargetPaths = lancePaths?.[lanceTarget] || lancePaths?.merged;
await fs.mkdir(lanceTargetPaths.dir, { recursive: true });
await fs.writeFile(lanceTargetPaths.metaPath, JSON.stringify({ dims: 512, count: 9 }));

const readJsonOptional = (filePath) => {
  if (!filePath || !fsSync.existsSync(filePath)) return null;
  try {
    return JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

let activeIo = 0;
let maxConcurrentIo = 0;
const scheduleIo = async (worker) => {
  activeIo += 1;
  maxConcurrentIo = Math.max(maxConcurrentIo, activeIo);
  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return await worker();
  } finally {
    activeIo -= 1;
  }
};

const first = await resolvePublishedBackendStates({
  mode,
  indexDir,
  denseVectorMode,
  hnswConfig: { enabled: true },
  lanceConfig: { enabled: true },
  finalDims: 384,
  totalChunks: 11,
  scheduleIo,
  readJsonOptional
});

assert.equal(first.hnswState.enabled, true);
assert.equal(first.hnswState.available, true);
assert.equal(first.hnswState.target, hnswTarget);
assert.equal(first.hnswState.dims, 256);
assert.equal(first.hnswState.count, 7);
assert.equal(first.lancedbState.enabled, true);
assert.equal(first.lancedbState.available, true);
assert.equal(first.lancedbState.target, lanceTarget);
assert.equal(first.lancedbState.dims, 512);
assert.equal(first.lancedbState.count, 9);
assert.ok(
  maxConcurrentIo >= 2,
  `Expected concurrent metadata probing, observed max parallel IO=${maxConcurrentIo}`
);

await fs.rm(hnswPaths.indexPath, { force: true });
await fs.rm(lanceTargetPaths.metaPath, { force: true });
const second = await resolvePublishedBackendStates({
  mode,
  indexDir,
  denseVectorMode,
  hnswConfig: { enabled: true },
  lanceConfig: { enabled: true },
  finalDims: 384,
  totalChunks: 11,
  scheduleIo: async (worker) => worker(),
  readJsonOptional
});

assert.equal(second.hnswState.available, false);
assert.equal(second.hnswState.dims, 256);
assert.equal(second.hnswState.count, 7);
assert.equal(second.lancedbState.available, false);
assert.equal('dims' in second.lancedbState, false);
assert.equal('count' in second.lancedbState, false);

console.log('backend state probe helper test passed');
