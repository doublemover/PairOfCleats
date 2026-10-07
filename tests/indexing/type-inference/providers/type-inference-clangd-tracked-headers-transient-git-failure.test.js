#!/usr/bin/env node
import assert from 'node:assert/strict';
import { listTrackedHeaderPaths } from '../../../../src/index/tooling/clangd-provider.js';

import {
  normalizeTrackedHeaders,
  prepareTrackedHeaderRepo
} from './tracked-headers-fixture.js';

const { repoRoot } = await prepareTrackedHeaderRepo('clangd-tracked-headers-transient-git-failure');

const originalPATH = process.env.PATH;
const originalPath = process.env.Path;

try {
  process.env.PATH = '';
  process.env.Path = '';
  const failed = listTrackedHeaderPaths(repoRoot);
  assert.deepEqual(failed, [], 'expected transient git failure to return empty header list');
} finally {
  if (originalPATH === undefined) delete process.env.PATH;
  else process.env.PATH = originalPATH;
  if (originalPath === undefined) delete process.env.Path;
  else process.env.Path = originalPath;
}

const recovered = normalizeTrackedHeaders(repoRoot);
assert.ok(recovered.includes('include/a.h'), 'expected tracked header listing to recover after transient git failure');

console.log('clangd tracked headers transient git failure test passed');
