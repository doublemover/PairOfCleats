#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import {
  readCachedBundle,
  readCachedImports,
  writeIncrementalBundle
} from '../../../src/index/build/incremental.js';
import { sha1 } from '../../../src/shared/hash.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'incremental-shared-buffer-hash');
const bundleDir = path.join(tempRoot, 'incremental', 'code', 'files');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });

const absPath = path.join(tempRoot, 'src', 'file.js');
await fs.mkdir(path.dirname(absPath), { recursive: true });
const text = [
  'import { value } from "./dep.js";',
  'export const answer = value + 1;'
].join('\n');
await fs.writeFile(absPath, `${text}\n`, 'utf8');
const sourceBuffer = await fs.readFile(absPath);
const relKey = 'src/file.js';
const coarseStat = {
  size: sourceBuffer.length,
  mtimeMs: 2000
};
const fileHash = sha1(sourceBuffer);

const manifestEntry = await writeIncrementalBundle({
  enabled: true,
  bundleDir,
  relKey,
  fileStat: coarseStat,
  fileHash,
  fileChunks: [],
  fileRelations: { imports: ['./dep.js'] },
  vfsManifestRows: null,
  bundleFormat: 'json'
});
assert.ok(manifestEntry, 'expected incremental bundle write');
const manifest = {
  bundleFormat: 'json',
  files: {
    [relKey]: manifestEntry
  }
};

const sharedReadState = new Map();
const originalReadFile = fsPromises.readFile;
let sourceReadCount = 0;
fsPromises.readFile = async (...args) => {
  if (String(args[0]) === absPath) sourceReadCount += 1;
  return originalReadFile(...args);
};

let bundleResult = null;
let importsResult = null;
try {
  bundleResult = await readCachedBundle({
    enabled: true,
    absPath,
    relKey,
    fileStat: coarseStat,
    manifest,
    bundleDir,
    bundleFormat: 'json',
    sharedReadState
  });
  importsResult = await readCachedImports({
    enabled: true,
    absPath,
    relKey,
    fileStat: coarseStat,
    manifest,
    bundleDir,
    bundleFormat: 'json',
    sharedReadState
  });
} finally {
  fsPromises.readFile = originalReadFile;
}

assert.ok(bundleResult?.cachedBundle, 'expected cached bundle hit');
assert.equal(bundleResult.fileHash, fileHash, 'expected source hash from cached bundle lookup');
assert.deepEqual(importsResult, ['./dep.js'], 'expected cached imports to match bundle contents');
assert.equal(sourceReadCount, 1, 'expected source bytes to be read once across bundle/import cache checks');

console.log('incremental shared buffer/hash reuse for bundle+imports test passed');
