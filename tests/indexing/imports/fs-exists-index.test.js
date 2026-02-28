#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createFsExistsIndex } from '../../../src/index/build/import-resolution.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'fs-exists-index');
const srcRoot = path.join(tempRoot, 'src');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });
await fs.writeFile(path.join(srcRoot, 'main.js'), 'export {};\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'generated.txt'), 'hello\n', 'utf8');

const entries = [
  { abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }
];

const fullIndex = await createFsExistsIndex({
  root: tempRoot,
  entries
});
assert.equal(fullIndex?.enabled, true);
assert.equal(fullIndex?.complete, true);
assert.equal(fullIndex?.lookup('src/main.js'), 'present');
assert.equal(fullIndex?.lookup('generated.txt'), 'present');
assert.equal(fullIndex?.lookup('missing/file.js'), 'absent');

const truncatedIndex = await createFsExistsIndex({
  root: tempRoot,
  entries,
  resolverPlugins: {
    fsExistsIndex: {
      maxScanFiles: 1
    }
  }
});
assert.equal(truncatedIndex?.enabled, true);
assert.equal(truncatedIndex?.complete, false);
assert.equal(truncatedIndex?.lookup('src/main.js'), 'present');
assert.equal(truncatedIndex?.lookup('missing/file.js'), 'unknown');

console.log('fs exists index test passed');
