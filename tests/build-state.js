#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initBuildState, markBuildPhase, updateBuildState, resolveBuildStatePath } from '../src/index/build/build-state.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-build-state-'));
const buildRoot = path.join(tempRoot, 'build');

await initBuildState({
  buildRoot,
  buildId: 'build-1',
  repoRoot: tempRoot,
  modes: ['code'],
  stage: 'stage1',
  configHash: 'hash',
  toolVersion: 'test',
  repoProvenance: { commit: 'abc' },
  signatureVersion: 2
});

await Promise.all([
  updateBuildState(buildRoot, { progress: { code: { processedFiles: 5, totalFiles: 10 } } }),
  markBuildPhase(buildRoot, 'processing', 'running')
]);

const statePath = resolveBuildStatePath(buildRoot);
const state = JSON.parse(await fs.readFile(statePath, 'utf8'));

assert.ok(state.progress?.code, 'expected progress update to persist');
assert.ok(state.phases?.processing, 'expected phase update to persist');
assert.equal(state.currentPhase, 'processing', 'expected currentPhase to be set');
assert.ok(!Object.prototype.hasOwnProperty.call(state, 'phase'), 'unexpected legacy phase field');

console.log('build state tests passed');
