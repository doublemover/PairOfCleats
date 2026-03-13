#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  flushBuildState,
  initBuildState,
  updateBuildState
} from '../../../src/index/build/build-state.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-build-state-skip-write-'));
const buildRoot = path.join(tempRoot, 'build');
const statePath = path.join(buildRoot, 'build_state.json');
const progressPath = path.join(buildRoot, 'build_state.progress.json');

try {
  await initBuildState({
    buildRoot,
    buildId: 'state-skip-rewrite',
    repoRoot: tempRoot,
    modes: ['code'],
    stage: 'stage1',
    configHash: 'cfg',
    toolVersion: 'test',
    repoProvenance: { provider: 'none' },
    signatureVersion: 1
  });

  await updateBuildState(buildRoot, {
    stage: 'stage1',
    progress: {
      code: {
        processed: 1,
        total: 10
      }
    }
  });
  await flushBuildState(buildRoot);

  await fs.rm(statePath, { force: true });
  await fs.rm(progressPath, { force: true });

  await updateBuildState(buildRoot, {
    stage: 'stage1',
    progress: {
      code: {
        processed: 1,
        total: 10
      }
    }
  });
  await flushBuildState(buildRoot);

  const [stateText, progressText] = await Promise.all([
    fs.readFile(statePath, 'utf8'),
    fs.readFile(progressPath, 'utf8')
  ]);
  const state = JSON.parse(stateText);
  const progress = JSON.parse(progressText);

  assert.equal(state.stage, 'stage1', 'expected state file to be recreated after deletion');
  assert.equal(progress.code.processed, 1, 'expected progress sidecar to be recreated after deletion');

  console.log('build state skip write missing files test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
