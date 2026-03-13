#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanImports } from '../../../src/index/build/imports.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-cache-hints-reuse');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'repo'), { recursive: true });

const starlarkPath = path.join(tempRoot, 'repo', 'MODULE.bazel');
await fs.writeFile(starlarkPath, 'load("//tools:deps.bzl", "deps")\n', 'utf8');
const stat = await fs.stat(starlarkPath);

let cachedReads = 0;
const readCachedImportsFn = async () => {
  cachedReads += 1;
  return ['//tools:deps.bzl'];
};

const result = await scanImports({
  files: [{ abs: starlarkPath, rel: 'repo/MODULE.bazel', stat }],
  root: tempRoot,
  mode: 'code',
  languageOptions: {},
  importConcurrency: 1,
  incrementalState: {
    enabled: true,
    manifest: { files: {} },
    bundleDir: tempRoot,
    bundleFormat: 'json'
  },
  readCachedImportsFn
});

assert.equal(cachedReads, 1, 'expected one cached import read');
assert.deepEqual(result.importsByFile['repo/MODULE.bazel'] || [], ['//tools:deps.bzl']);
assert.equal(
  result.importHintsByFile?.['repo/MODULE.bazel']?.['//tools:deps.bzl']?.reasonCode,
  'IMP_U_RESOLVER_GAP',
  'expected collector hint to be rebuilt on cached import reuse'
);

console.log('import cache hints reuse test passed');
