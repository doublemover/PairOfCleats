#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-resolution-cmake-directory-imports');

await fs.rm(tempRoot, { recursive: true, force: true });

const write = async (relPath, content = '') => {
  const absPath = path.join(tempRoot, relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content);
};

await write('CMakeLists.txt', 'project(root)\n');
await write('test/add-subdirectory-test/CMakeLists.txt', 'add_subdirectory(../..)\n');
await write('test/static-export-test/CMakeLists.txt', 'add_subdirectory(../..)\n');

const entries = [
  'CMakeLists.txt',
  'test/add-subdirectory-test/CMakeLists.txt',
  'test/static-export-test/CMakeLists.txt'
].map((rel) => ({ abs: path.join(tempRoot, rel), rel }));

const importsByFile = {
  'test/add-subdirectory-test/CMakeLists.txt': ['../..'],
  'test/static-export-test/CMakeLists.txt': ['../..']
};

const fileRelations = new Map(Object.keys(importsByFile).map((file) => [
  file,
  { imports: importsByFile[file].slice() }
]));

const result = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations,
  enableGraph: false
});

assert.deepEqual(
  fileRelations.get('test/add-subdirectory-test/CMakeLists.txt')?.importLinks || [],
  ['CMakeLists.txt'],
  'expected add-subdirectory-test CMakeLists to resolve ../.. to root CMakeLists.txt'
);
assert.deepEqual(
  fileRelations.get('test/static-export-test/CMakeLists.txt')?.importLinks || [],
  ['CMakeLists.txt'],
  'expected static-export-test CMakeLists to resolve ../.. to root CMakeLists.txt'
);
assert.equal(result?.stats?.unresolved || 0, 0, 'expected no unresolved imports');

console.log('cmake directory imports test passed');
