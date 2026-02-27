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

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-build-state-light-'));
const buildRoot = path.join(tempRoot, 'build');

await initBuildState({
  buildRoot,
  buildId: 'build-state-light-main',
  repoRoot: tempRoot,
  modes: ['code'],
  stage: 'stage1',
  configHash: 'cfg',
  toolVersion: 'test',
  repoProvenance: { provider: 'none' },
  signatureVersion: 1
});

const checkpoints = Array.from({ length: 80 }, (_, index) => ({
  at: new Date(1700000000000 + index * 1000).toISOString(),
  elapsedMs: index,
  stage: 'stage1',
  step: `step-${index}`,
  memory: { rss: index + 1 }
}));

await updateBuildState(buildRoot, {
  stageCheckpoints: {
    code: {
      stage1: {
        version: 1,
        generatedAt: new Date(1700000000000).toISOString(),
        checkpoints
      }
    }
  }
});
await flushBuildState(buildRoot);

const mainState = JSON.parse(await fs.readFile(path.join(buildRoot, 'build_state.json'), 'utf8'));
assert.equal(
  Object.prototype.hasOwnProperty.call(mainState, 'stageCheckpoints'),
  false,
  'main build_state.json should stay lightweight and exclude stageCheckpoints payloads'
);

const indexSidecar = JSON.parse(await fs.readFile(path.join(buildRoot, 'stage_checkpoints.v1.index.json'), 'utf8'));
const codeRel = indexSidecar?.modes?.code?.path;
assert.equal(typeof codeRel, 'string', 'checkpoint index should include mode sidecar path');

const codeSidecar = JSON.parse(await fs.readFile(path.join(buildRoot, codeRel), 'utf8'));
assert.equal(Array.isArray(codeSidecar?.stage1?.checkpoints), true, 'mode sidecar should keep checkpoint rows');
assert.equal(codeSidecar.stage1.checkpoints.length, checkpoints.length, 'checkpoint sidecar should preserve all rows');

console.log('build state lightweight main file test passed');
