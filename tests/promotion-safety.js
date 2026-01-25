#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from './helpers/test-env.js';
import { promoteBuild } from '../src/index/build/promotion.js';
import { getBuildsRoot, getCurrentBuildInfo, getRepoCacheRoot } from '../tools/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-promotion-'));
applyTestEnv({ cacheRoot: tempRoot });

const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(repoRoot, { recursive: true });
const userConfig = {};

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const outsideRoot = path.join(tempRoot, 'outside');
await fs.mkdir(outsideRoot, { recursive: true });

await assert.rejects(
  () => promoteBuild({
    repoRoot,
    userConfig,
    buildId: 'bad-build',
    buildRoot: outsideRoot,
    modes: ['code']
  }),
  /escapes repo cache root/
);

const buildsRoot = getBuildsRoot(repoRoot, userConfig);
await fs.mkdir(buildsRoot, { recursive: true });
const currentPath = path.join(buildsRoot, 'current.json');
const unsafeRoot = path.join(repoCacheRoot, '..', '..', 'outside');
await fs.writeFile(currentPath, JSON.stringify({
  buildId: 'unsafe-build',
  buildRoot: unsafeRoot
}, null, 2));

const info = getCurrentBuildInfo(repoRoot, userConfig);
assert.equal(info, null, 'expected unsafe current.json to be rejected');

console.log('promotion safety tests passed');
