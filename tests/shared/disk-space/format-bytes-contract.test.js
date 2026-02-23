#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { formatBytes, sizeOfPath } from '../../../src/shared/disk-space.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

assert.equal(formatBytes(0), '0B');
assert.equal(formatBytes(1), '1B');
assert.equal(formatBytes(1023), '1023B');
assert.equal(formatBytes(1024), '1.0KB');
assert.equal(formatBytes(1536), '1.5KB');
assert.equal(formatBytes(1024 * 1024), '1.0MB');
assert.equal(formatBytes(2 * 1024 * 1024 * 1024), '2.0GB');

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'disk-space-format-contract');
await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(path.join(outDir, 'sub'), { recursive: true });
await fsPromises.writeFile(path.join(outDir, 'a.txt'), 'abc', 'utf8');
await fsPromises.writeFile(path.join(outDir, 'sub', 'b.txt'), '12345', 'utf8');

assert.equal(await sizeOfPath(path.join(outDir, 'a.txt')), 3);
assert.equal(await sizeOfPath(outDir), 8);
assert.equal(await sizeOfPath(path.join(outDir, 'missing.txt')), 0);

console.log('disk-space format/size contracts ok.');
