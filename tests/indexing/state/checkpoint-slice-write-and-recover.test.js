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

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-checkpoint-slices-'));
const buildRoot = path.join(tempRoot, 'build');

const loadCheckpointAggregate = async () => {
  const index = JSON.parse(await fs.readFile(path.join(buildRoot, 'stage_checkpoints.v1.index.json'), 'utf8'));
  const out = {};
  for (const mode of Object.keys(index?.modes || {})) {
    const relPath = index.modes[mode]?.path;
    if (!relPath) continue;
    out[mode] = JSON.parse(await fs.readFile(path.join(buildRoot, relPath), 'utf8'));
  }
  return out;
};

await initBuildState({
  buildRoot,
  buildId: 'checkpoint-slice',
  repoRoot: tempRoot,
  modes: ['code', 'prose'],
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

const firstIndex = JSON.parse(await fs.readFile(path.join(buildRoot, 'stage_checkpoints.v1.index.json'), 'utf8'));
const codePath = path.join(buildRoot, firstIndex.modes.code.path);
const codeStatBefore = await fs.stat(codePath);

await updateBuildState(buildRoot, {
  stageCheckpoints: {
    prose: {
      stage1: {
        generatedAt: new Date(1700000001000).toISOString(),
        checkpoints: [{ stage: 'stage1', step: 'discover', elapsedMs: 2 }]
      }
    }
  }
});
await flushBuildState(buildRoot);

const codeStatAfterProse = await fs.stat(codePath);
assert.equal(
  codeStatAfterProse.mtimeMs,
  codeStatBefore.mtimeMs,
  'writing a different mode slice should not rewrite unchanged mode sidecars'
);

await updateBuildState(buildRoot, {
  stageCheckpoints: {
    code: {
      stage2: {
        generatedAt: new Date(1700000002000).toISOString(),
        checkpoints: [{ stage: 'stage2', step: 'write', elapsedMs: 3 }]
      }
    }
  }
});
await flushBuildState(buildRoot);

const codeStatAfterCode = await fs.stat(codePath);
assert.ok(
  codeStatAfterCode.mtimeMs >= codeStatAfterProse.mtimeMs,
  'updating the same mode should rewrite only that mode sidecar'
);

const recovered = await loadCheckpointAggregate();
assert.deepEqual(
  recovered,
  {
    code: {
      stage1: {
        generatedAt: new Date(1700000000000).toISOString(),
        checkpoints: [{ stage: 'stage1', step: 'discover', elapsedMs: 1 }]
      },
      stage2: {
        generatedAt: new Date(1700000002000).toISOString(),
        checkpoints: [{ stage: 'stage2', step: 'write', elapsedMs: 3 }]
      }
    },
    prose: {
      stage1: {
        generatedAt: new Date(1700000001000).toISOString(),
        checkpoints: [{ stage: 'stage1', step: 'discover', elapsedMs: 2 }]
      }
    }
  },
  'slice sidecars should reconstruct deterministic checkpoint state after reload'
);

console.log('checkpoint slice write and recover test passed');
