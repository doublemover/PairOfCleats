#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { __resolveDefaultToolingCacheDirForTests } from '../../../src/index/type-inference-crossfile/tooling.js';

const repoRoot = path.resolve('C:\\repo\\project');
const repoCacheBuildRoot = path.resolve('C:\\cache-root\\repos\\project\\builds\\20260307T000000Z_deadbeef');
const repoCacheToolingDir = __resolveDefaultToolingCacheDirForTests({
  rootDir: repoRoot,
  buildRoot: repoCacheBuildRoot
});
assert.equal(
  repoCacheToolingDir,
  path.resolve('C:\\cache-root\\repos\\project\\tooling-cache'),
  'expected build-root cache layout to resolve tooling cache under stable repo cache root'
);

const explicitBuildRoot = path.resolve('C:\\tmp\\explicit-index-root');
const fallbackToolingDir = __resolveDefaultToolingCacheDirForTests({
  rootDir: repoRoot,
  buildRoot: explicitBuildRoot
});
assert.equal(
  fallbackToolingDir,
  path.resolve('C:\\repo\\project\\.build\\pairofcleats\\tooling-cache'),
  'expected non-builds roots to fall back to repo-local tooling cache'
);

console.log('tooling cache root default test passed');
