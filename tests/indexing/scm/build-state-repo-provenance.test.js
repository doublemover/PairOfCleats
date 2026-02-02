#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { initBuildState } from '../../../src/index/build/build-state.js';
import { getScmProviderAndRoot } from '../../../src/index/scm/registry.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const tempRoot = await makeTempDir('poc-build-state-scm-');
const buildRoot = path.join(tempRoot, 'build');
try {
  const selection = getScmProviderAndRoot({ provider: 'none', startPath: tempRoot });
  const repoProvenance = await selection.providerImpl.getRepoProvenance({ repoRoot: selection.repoRoot });
  const statePath = await initBuildState({
    buildRoot,
    buildId: 'test-build',
    repoRoot: selection.repoRoot,
    modes: ['code'],
    stage: 'stage2',
    configHash: 'deadbeef',
    toolVersion: 'test',
    repoProvenance,
    signatureVersion: 1
  });
  const state = JSON.parse(await fsPromises.readFile(statePath, 'utf8'));
  assert(state.repo, 'build_state should include repo provenance');
  assert.equal(state.repo.provider, 'none');
  assert.equal(state.repo.head, null);
  assert.equal(state.repo.root, selection.repoRoot);
} finally {
  await rmDirRecursive(tempRoot);
}

console.log('build_state repo provenance ok');
