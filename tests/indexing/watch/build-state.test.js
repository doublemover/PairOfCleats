#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initBuildState, markBuildPhase, updateBuildState, resolveBuildStatePath } from '../../../src/index/build/build-state.js';

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
const progressPath = path.join(buildRoot, 'build_state.progress.json');
const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
let progress = state.progress;
if (!progress?.code) {
  try {
    progress = JSON.parse(await fs.readFile(progressPath, 'utf8'));
  } catch {}
}

assert.ok(progress?.code, 'expected progress update to persist');
assert.ok(state.phases?.processing, 'expected phase update to persist');
assert.equal(state.currentPhase, 'processing', 'expected currentPhase to be set');
assert.ok(!Object.prototype.hasOwnProperty.call(state, 'phase'), 'unexpected legacy phase field');

await fs.rm(statePath, { force: true });
await markBuildPhase(buildRoot, 'processing', 'running');
const rewrittenState = JSON.parse(await fs.readFile(statePath, 'utf8'));
assert.ok(rewrittenState.phases?.processing, 'expected identical phase patch to recreate missing build_state.json');

await fs.rm(progressPath, { force: true });
await updateBuildState(buildRoot, { progress: { code: { processedFiles: 5, totalFiles: 10 } } });
const rewrittenProgress = JSON.parse(await fs.readFile(progressPath, 'utf8'));
assert.equal(rewrittenProgress?.code?.processedFiles, 5, 'expected identical progress patch to recreate missing progress sidecar');

console.log('build state tests passed');
