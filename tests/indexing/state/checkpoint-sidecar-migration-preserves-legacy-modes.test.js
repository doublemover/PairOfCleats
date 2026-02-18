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

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-checkpoint-migration-'));
const buildRoot = path.join(tempRoot, 'build');

await initBuildState({
  buildRoot,
  buildId: 'checkpoint-migration',
  repoRoot: tempRoot,
  modes: ['code', 'prose'],
  stage: 'stage1',
  configHash: 'cfg',
  toolVersion: 'test',
  repoProvenance: { provider: 'none' },
  signatureVersion: 1
});

const legacyCheckpoints = {
  code: {
    stage1: {
      generatedAt: new Date(1700000000000).toISOString(),
      checkpoints: [{ stage: 'stage1', step: 'discover', elapsedMs: 1 }]
    }
  },
  prose: {
    stage1: {
      generatedAt: new Date(1700000001000).toISOString(),
      checkpoints: [{ stage: 'stage1', step: 'discover', elapsedMs: 2 }]
    }
  }
};

await fs.writeFile(
  path.join(buildRoot, 'build_state.stage-checkpoints.json'),
  JSON.stringify(legacyCheckpoints, null, 2)
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

const sidecarIndex = JSON.parse(await fs.readFile(path.join(buildRoot, 'stage_checkpoints.v1.index.json'), 'utf8'));
assert.deepEqual(
  Object.keys(sidecarIndex?.modes || {}).sort(),
  ['code', 'prose'],
  'first sidecar migration should preserve all legacy checkpoint modes'
);

const restored = {};
for (const mode of Object.keys(sidecarIndex?.modes || {})) {
  const relPath = sidecarIndex.modes[mode]?.path;
  if (!relPath) continue;
  restored[mode] = JSON.parse(await fs.readFile(path.join(buildRoot, relPath), 'utf8'));
}

assert.deepEqual(
  restored,
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
  'migrated sidecars should retain untouched legacy modes while applying patch updates'
);

console.log('checkpoint sidecar migration preserves legacy modes test passed');
