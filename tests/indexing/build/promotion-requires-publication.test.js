#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { applyTestEnv } from '../../helpers/test-env.js';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-promotion-publication-'));
applyTestEnv({ cacheRoot: tempRoot });

try {
  const repoRoot = path.join(tempRoot, 'repo');
  const userConfig = {};
  await fs.mkdir(repoRoot, { recursive: true });

  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const buildRoot = path.join(buildsRoot, 'build-a');
  await fs.mkdir(buildRoot, { recursive: true });

  await assert.rejects(
    () => promoteBuild({
      repoRoot,
      userConfig,
      buildId: 'build-a',
      buildRoot,
      stage: 'stage2',
      modes: ['code']
    }),
    /missing publication record/
  );

  await seedPublishedArtifacts({ buildRoot, mode: 'code', buildId: 'build-a' });
  await promoteBuild({
    repoRoot,
    userConfig,
    buildId: 'build-a',
    buildRoot,
    stage: 'stage2',
    modes: ['code']
  });

  const current = JSON.parse(await fs.readFile(path.join(buildsRoot, 'current.json'), 'utf8'));
  assert.equal(current.buildId, 'build-a');
  assert.equal(current.stage, 'stage2');

  console.log('promotion requires publication test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
