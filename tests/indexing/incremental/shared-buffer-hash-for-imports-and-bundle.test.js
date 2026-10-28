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
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { collectLanguageImports } from '../../../src/index/language-registry.js';
import { getImportExtraction } from '../../../src/shared/import-extraction.js';

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
await fs.utimes(absPath, new Date(2000), new Date(2000));
const coarseStat = await fs.stat(absPath);
const fileHash = sha1(sourceBuffer);
const imports = collectLanguageImports({ text: sourceBuffer.toString('utf8'), ext: '.js', relPath: relKey, mode: 'code' });

const manifestEntry = await writeIncrementalBundle({
  enabled: true,
  bundleDir,
  relKey,
  fileStat: coarseStat,
  fileHash,
  fileChunks: [],
  fileRelations: { imports, importExtraction: getImportExtraction(imports) },
  vfsManifestRows: null,
  bundleFormat: 'json'
});
assert.ok(manifestEntry, 'expected incremental bundle write');
const manifest = {
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  bundleFormat: 'json',
  files: {
    [relKey]: manifestEntry
  }
};

const sharedReadState = new Map();
const originalOpen = fsPromises.open;
let sourceReadCount = 0;
/**
 * Intercept source reads so this test can assert shared read-state reuse
 * across bundle/import cache lookups.
 */
fsPromises.open = async (file, ...args) => {
  const handle = await originalOpen.call(fsPromises, file, ...args);
  if (path.relative(String(file), absPath) === '') {
    const read = handle.read;
    handle.read = async function (...args) { const result = await read.apply(this, args); if (result.bytesRead > 0) sourceReadCount++; return result; };
  }
  return handle;
};

let bundleResult = null;
let importsResult = null;
try {
  bundleResult = await readCachedBundle({
    repoRoot: tempRoot,
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
    repoRoot: tempRoot,
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
  fsPromises.open = originalOpen;
}

assert.ok(bundleResult?.cachedBundle, 'expected cached bundle hit');
assert.equal(bundleResult.fileHash, fileHash, 'expected source hash from cached bundle lookup');
assert.deepEqual(importsResult, ['./dep.js'], 'expected cached imports to match bundle contents');
assert.equal(sourceReadCount, 1, 'expected source bytes to be read once across bundle/import cache checks');

await fs.utimes(absPath, new Date(2001), new Date(2001));
const changedStat = await fs.stat(absPath);
const changedSharedReadState = new Map();
let changedSourceReadCount = 0;
/**
 * Second interception verifies hash-fallback lookups still share one source read.
 */
fsPromises.open = async (file, ...args) => {
  const handle = await originalOpen.call(fsPromises, file, ...args);
  if (path.relative(String(file), absPath) === '') {
    const read = handle.read;
    handle.read = async function (...args) { const result = await read.apply(this, args); if (result.bytesRead > 0) changedSourceReadCount++; return result; };
  }
  return handle;
};

let changedBundleResult = null;
let changedImportsResult = null;
try {
  changedBundleResult = await readCachedBundle({
    enabled: true,
    absPath,
    relKey,
    fileStat: changedStat,
    manifest,
    bundleDir,
    bundleFormat: 'json',
    sharedReadState: changedSharedReadState
  });
  changedImportsResult = await readCachedImports({
    enabled: true,
    absPath,
    relKey,
    fileStat: changedStat,
    manifest,
    bundleDir,
    bundleFormat: 'json',
    sharedReadState: changedSharedReadState
  });
} finally {
  fsPromises.open = originalOpen;
}

assert.ok(changedBundleResult?.cachedBundle, 'expected hash-validated bundle hit after stat drift');
assert.equal(changedBundleResult.fileHash, fileHash, 'expected hash comparison to preserve cache hit');
assert.deepEqual(changedImportsResult, ['./dep.js'], 'expected imports cache hit after stat drift');
assert.equal(
  changedSourceReadCount,
  1,
  'expected source bytes to be read once across hash-fallback bundle/import checks'
);

console.log('incremental shared buffer/hash reuse for bundle+imports test passed');
