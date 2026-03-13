#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndexSignature } from '../../../src/retrieval/index-cache.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-index-signature-cache-'));
const dirs = [];
for (let i = 0; i < 300; i += 1) {
  const dir = path.join(root, `idx-${i}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'index_state.json'),
    JSON.stringify({ buildId: `build-${i}`, mode: 'code', artifactSurfaceVersion: '1' }),
    'utf8'
  );
  dirs.push(dir);
}

for (const dir of dirs) {
  await buildIndexSignature(dir);
}

const originalReadFile = fs.readFile;
let readCount = 0;
fs.readFile = async (...args) => {
  readCount += 1;
  return originalReadFile(...args);
};

try {
  await buildIndexSignature(dirs[0]);
} finally {
  fs.readFile = originalReadFile;
  await fs.rm(root, { recursive: true, force: true });
}

assert.ok(readCount > 0, 'expected oldest signature cache entry to be evicted and recomputed');

console.log('index signature cache bounds test passed');
