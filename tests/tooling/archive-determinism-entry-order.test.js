#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  buildDeterministicZip
} from '../../tools/tooling/archive-determinism.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'archive-determinism-entry-order');
const sourceDir = path.join(tempRoot, 'src');
const archivePath = path.join(tempRoot, 'bundle.zip');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(sourceDir, 'dir'), { recursive: true });
await fsPromises.writeFile(path.join(sourceDir, 'b.txt'), 'b\n', 'utf8');
await fsPromises.writeFile(path.join(sourceDir, 'a.txt'), 'a\n', 'utf8');
await fsPromises.writeFile(path.join(sourceDir, 'dir', 'c.txt'), 'c\n', 'utf8');

const result = await buildDeterministicZip({ sourceDir, archivePath });

assert.ok(result && typeof result === 'object', 'expected deterministic zip result payload');
assert.equal(result.entries.length, 3, 'expected all source files to be listed in manifest entries');
assert.deepEqual(
  result.entries.map((entry) => entry.path),
  ['a.txt', 'b.txt', 'dir/c.txt'],
  'expected entries to be path-sorted'
);
for (const entry of result.entries) {
  assert.ok(Number.isInteger(entry.mode), 'expected entry mode to be integer');
  assert.ok(Number.isFinite(entry.sizeBytes) && entry.sizeBytes > 0, 'expected positive entry size');
  assert.equal(typeof entry.mtime, 'string', 'expected ISO mtime on each entry');
}
assert.ok(/^[a-f0-9]{64}$/i.test(result.checksum), 'expected SHA-256 checksum');

console.log('archive determinism entry-order test passed');
