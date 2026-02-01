#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesSharded } from '../../../src/shared/json-stream.js';

const root = process.cwd();
const cacheRoot = path.join(root, '.testCache', 'json-stream-typedarray-sharded');
await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const items = [
  { id: 1, vec: new Uint8Array([1, 2, 3]) },
  { id: 2, vec: new Uint8Array([4, 5, 6]) }
];

const result = await writeJsonLinesSharded({
  dir: cacheRoot,
  partsDirName: 'typed.parts',
  partPrefix: 'typed.part-',
  items,
  maxBytes: 1024,
  atomic: true
});

assert.ok(result.parts.length >= 1, 'expected at least one sharded output');
const partPath = path.join(cacheRoot, result.parts[0].split('/').join(path.sep));
const raw = await fs.readFile(partPath, 'utf8');
const line = raw.trim().split(/\r?\n/)[0];
const parsed = JSON.parse(line);
assert.deepEqual(parsed.vec, [1, 2, 3], 'expected typed arrays serialized as JSON arrays');

console.log('json-stream typed array sharded test passed');

