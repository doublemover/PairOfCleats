#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  flushBuildState,
  initBuildState,
  updateBuildState
} from '../../../src/index/build/build-state.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-checkpoint-naming-'));
const buildRoot = path.join(tempRoot, 'build');

await initBuildState({
  buildRoot,
  buildId: 'checkpoint-sidecar-naming',
  repoRoot: tempRoot,
  modes: ['code'],
  stage: 'stage1',
  configHash: 'cfg',
  toolVersion: 'test',
  repoProvenance: { provider: 'none' },
  signatureVersion: 1
});

await updateBuildState(buildRoot, {
  stageCheckpoints: {
    code: {
      stage1: {
        generatedAt: new Date(1700000000000).toISOString(),
        checkpoints: [{ stage: 'stage1', step: 'discover', elapsedMs: 1 }]
      }
    }
  }
});
await flushBuildState(buildRoot);

const entries = await fs.readdir(buildRoot);
const sidecars = entries.filter((name) => name.startsWith('stage_checkpoints.v1.'));
assert.ok(sidecars.includes('stage_checkpoints.v1.index.json'), 'expected versioned checkpoint index file');
assert.ok(sidecars.includes('stage_checkpoints.v1.code.json'), 'expected versioned per-mode sidecar');
for (const fileName of sidecars) {
  assert.match(
    fileName,
    /^stage_checkpoints\.v1\.(index|[A-Za-z0-9._-]+)\.json$/,
    'checkpoint sidecars should use stable stage_checkpoints.v1.* naming'
  );
}

console.log('checkpoint sidecar naming versioned test passed');
