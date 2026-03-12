#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  readBundleFile,
  resolveBundlePatchMetaPath,
  writeBundlePatch,
  writeBundleFile
} from '../../src/shared/bundle-io.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'bundle-io-patch-append');
const bundlePath = path.join(tempRoot, 'bundle.json');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const initialBundle = {
  file: 'src/main.js',
  hash: 'hash-a',
  mtimeMs: 1,
  size: 10,
  chunks: [{ text: 'one' }],
  fileRelations: { imports: ['./a.js'] }
};
await writeBundleFile({ bundlePath, format: 'json', bundle: initialBundle });

const secondBundle = {
  ...initialBundle,
  hash: 'hash-b',
  fileRelations: { imports: ['./a.js'], exports: ['thing'] }
};
await writeBundlePatch({
  bundlePath,
  format: 'json',
  previousBundle: initialBundle,
  nextBundle: secondBundle
});

const thirdBundle = {
  ...secondBundle,
  size: 11,
  chunks: [{ text: 'one' }, { text: 'two' }]
};
await writeBundlePatch({
  bundlePath,
  format: 'json',
  previousBundle: secondBundle,
  nextBundle: thirdBundle
});

const readResult = await readBundleFile(bundlePath, { format: 'json' });
assert.equal(readResult.ok, true, `expected readable bundle after sequential patch appends: ${readResult.reason || 'unknown'}`);
assert.equal(readResult.bundle.hash, 'hash-b', 'expected earlier patch-set update to survive later append');
assert.deepEqual(readResult.bundle.fileRelations.exports, ['thing'], 'expected earlier patch-set field to survive later append');
assert.equal(readResult.bundle.size, 11, 'expected latest scalar update to be applied');
assert.equal(readResult.bundle.chunks.length, 2, 'expected latest chunk patch to be applied');
const patchMeta = JSON.parse(await fs.readFile(resolveBundlePatchMetaPath(bundlePath), 'utf8'));
const patchStat = await fs.stat(`${bundlePath}.patch.jsonl`);
assert.equal(patchMeta.bytes, patchStat.size, 'expected patch meta bytes to match patch file size');

console.log('bundle io patch append test passed');
