#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';
import { resolveModeExecutionPlan } from '../../../src/storage/sqlite/build/runner/mode-plan.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-build-root-active-generation-plan');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const userConfig = { cache: { root: cacheRoot } };

const normalizePath = (value) => {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const buildsRoot = path.join(repoCacheRoot, 'builds');
const buildId = '20260323T000000Z-active';
const activeRoot = path.join(buildsRoot, buildId);

await fs.mkdir(path.join(activeRoot, 'index-code'), { recursive: true });
await fs.writeFile(path.join(activeRoot, 'index-code', 'chunk_meta.jsonl.gz'), '', 'utf8');
await fs.writeFile(
  path.join(buildsRoot, 'current.json'),
  JSON.stringify({
    buildId,
    buildRoot: '.',
    buildRootsByMode: {
      code: '.'
    }
  }, null, 2),
  'utf8'
);

const plan = resolveModeExecutionPlan({
  modeArg: 'code',
  root: repoRoot,
  argv: {},
  options: {},
  runtime: null,
  userConfig
});

assert.equal(plan.errorMessage, undefined, 'expected sqlite mode planning to succeed');
assert.equal(
  normalizePath(plan.indexRoot),
  normalizePath(activeRoot),
  'expected sqlite mode planning to prefer the active generation root'
);
assert.equal(
  normalizePath(plan.modeIndexDirs.code),
  normalizePath(path.join(activeRoot, 'index-code')),
  'expected sqlite mode plan to resolve code index dir under the active generation root'
);

await fs.writeFile(
  path.join(buildsRoot, 'current.json'),
  JSON.stringify({
    buildId,
    buildRoot: '.',
    buildRootsByMode: {
      code: '.'
    }
  }, null, 2),
  'utf8'
);
await fs.rm(activeRoot, { recursive: true, force: true });

const missingPlan = resolveModeExecutionPlan({
  modeArg: 'code',
  root: repoRoot,
  argv: {},
  options: {},
  runtime: null,
  userConfig
});

assert.match(
  missingPlan.errorMessage || '',
  /active build root|missing active build root/i,
  'expected sqlite mode planning to fail closed instead of falling back to repo-root manifests'
);

console.log('sqlite build-root active generation plan test passed');
