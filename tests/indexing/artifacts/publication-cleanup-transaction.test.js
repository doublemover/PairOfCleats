#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { prepareArtifactCleanup } from '../../../src/index/build/artifacts-write/family-dispatch.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-artifact-cleanup-transaction-'));

try {
  const outDir = path.join(tempRoot, 'index-code');
  await fs.mkdir(outDir, { recursive: true });
  const fileMetaPath = path.join(outDir, 'file_meta.json');
  await fs.writeFile(fileMetaPath, '{"rows":[]}\n', 'utf8');

  const indexState = {};
  const removedPaths = [];
  const cleanup = await prepareArtifactCleanup({
    outDir,
    log: () => {},
    logLine: () => {},
    vectorOnlyProfile: false,
    tokenPostingsFormat: 'json',
    tokenPostingsUseShards: false,
    effectiveAbortSignal: null,
    indexState,
    profileId: 'test-profile',
    removePieceFile: (targetPath) => removedPaths.push(path.basename(targetPath))
  });

  await cleanup.removeArtifact(fileMetaPath, { policy: 'legacy' });

  await fs.access(fileMetaPath);
  assert.equal(cleanup.cleanupActions.length, 1, 'expected staged cleanup action');
  assert.equal(cleanup.cleanupActions[0].phase, 'staged');
  assert.equal(indexState.extensions.artifactCleanup.status, 'staged');
  assert.equal(indexState.extensions.artifactCleanup.plannedActions, 1);

  const summary = await cleanup.commitArtifactCleanup();

  await assert.rejects(() => fs.access(fileMetaPath), /ENOENT/);
  assert.equal(summary.status, 'completed');
  assert.equal(summary.plannedActions, 1);
  assert.equal(summary.completedActions, 1);
  assert.equal(summary.failedActions, 0);
  assert.deepEqual(removedPaths, ['file_meta.json']);
  assert.equal(indexState.extensions.artifactCleanup.status, 'completed');
  assert.equal(indexState.extensions.artifactCleanup.completedActions, 1);

  console.log('artifact cleanup transaction test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
