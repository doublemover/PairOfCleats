#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../helpers/test-env.js';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { initBuildState, resolveBuildStatePath, updateBuildState } from '../../../src/index/build/build-state.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-stage-progression-'));
applyTestEnv({ cacheRoot: tempRoot });

const repoRoot = path.join(tempRoot, 'repo');
const userConfig = {};
await fs.mkdir(repoRoot, { recursive: true });

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const buildRoot = path.join(repoCacheRoot, 'builds', 'build-contract');
await fs.mkdir(buildRoot, { recursive: true });

await initBuildState({
  buildRoot,
  buildId: 'build-contract',
  repoRoot,
  modes: ['code'],
  stage: 'stage2',
  configHash: 'hash-stage2',
  toolVersion: 'test',
  repoProvenance: { provider: 'none', root: repoRoot },
  signatureVersion: 1
});

await promoteBuild({
  repoRoot,
  userConfig,
  buildId: 'build-contract',
  buildRoot,
  stage: 'stage2',
  modes: ['code'],
  configHash: 'hash-stage2'
});

const buildsRoot = path.join(repoCacheRoot, 'builds');
const currentPath = path.join(buildsRoot, 'current.json');
const currentStage2 = JSON.parse(await fs.readFile(currentPath, 'utf8'));
assert.equal(currentStage2.stage, 'stage2', 'expected initial promotion stage to be stage2');

await updateBuildState(buildRoot, { stage: 'stage4' });
await promoteBuild({
  repoRoot,
  userConfig,
  buildId: 'build-contract',
  buildRoot,
  stage: 'stage4',
  modes: ['code'],
  configHash: 'hash-stage4'
});

const currentStage4 = JSON.parse(await fs.readFile(currentPath, 'utf8'));
assert.equal(currentStage4.stage, 'stage4', 'expected stage progression to stage4');
assert.equal(currentStage4.buildRoot, currentStage2.buildRoot, 'expected same build root to be promoted');

const statePath = resolveBuildStatePath(buildRoot);
const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
assert.equal(state.stage, 'stage4', 'expected build_state stage to reflect stage4 progression');

console.log('stage progression contract test passed');
