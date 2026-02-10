#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../helpers/test-env.js';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-promotion-timing-'));
applyTestEnv({ cacheRoot: tempRoot });

const repoRoot = path.join(tempRoot, 'repo');
const userConfig = {};
await fs.mkdir(repoRoot, { recursive: true });

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const buildsRoot = path.join(repoCacheRoot, 'builds');
const buildRoot = path.join(buildsRoot, 'build-ok');
await fs.mkdir(buildRoot, { recursive: true });

await promoteBuild({
  repoRoot,
  userConfig,
  buildId: 'build-ok',
  buildRoot,
  stage: 'stage2',
  modes: ['code']
});

const currentPath = path.join(buildsRoot, 'current.json');
const before = JSON.parse(await fs.readFile(currentPath, 'utf8'));

const outsideRoot = path.join(tempRoot, 'outside');
await fs.mkdir(outsideRoot, { recursive: true });
await assert.rejects(
  () => promoteBuild({
    repoRoot,
    userConfig,
    buildId: 'build-bad',
    buildRoot: outsideRoot,
    stage: 'stage4',
    modes: ['code']
  }),
  /escapes repo cache root/
);

const afterRejected = JSON.parse(await fs.readFile(currentPath, 'utf8'));
assert.deepEqual(afterRejected, before, 'expected rejected promotion to leave current.json unchanged');

await promoteBuild({
  repoRoot,
  userConfig,
  buildId: 'build-ok',
  buildRoot,
  stage: 'stage4',
  modes: ['code']
});

const afterStage4 = JSON.parse(await fs.readFile(currentPath, 'utf8'));
assert.equal(afterStage4.stage, 'stage4', 'expected promotion to publish stage4 only on successful write');

console.log('promotion timing contract test passed');
