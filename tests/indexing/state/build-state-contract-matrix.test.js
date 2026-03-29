#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import {
  flushBuildState,
  initBuildState,
  updateBuildState
} from '../../../src/index/build/build-state.js';
import {
  applyStatePatch,
  isBuildStateLockUnavailableResult
} from '../../../src/index/build/build-state/store.js';
import { BUILD_STATE_DURABILITY_CLASS } from '../../../src/index/build/build-state/durability.js';

const withTempBuildRoot = async (prefix, run) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const buildRoot = path.join(tempRoot, 'build');
  await fs.mkdir(buildRoot, { recursive: true });
  try {
    await run({ tempRoot, buildRoot });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
};

await withTempBuildRoot('poc-build-state-lock-retryable-', async ({ buildRoot }) => {
  const lockPath = path.join(buildRoot, 'build_state.write.lock');
  const heldLock = await acquireFileLock({
    lockPath,
    waitMs: 0,
    pollMs: 1,
    staleMs: 30000,
    timeoutBehavior: 'null',
    metadata: { scope: 'build-state-lock-unavailable-test' }
  });
  assert.ok(heldLock);
  try {
    const result = await applyStatePatch(
      buildRoot,
      {
        heartbeat: {
          stage: 'test',
          lastHeartbeatAt: new Date().toISOString()
        }
      },
      [],
      { durabilityClass: BUILD_STATE_DURABILITY_CLASS.BEST_EFFORT }
    );
    assert.equal(isBuildStateLockUnavailableResult(result), true);
    assert.equal(result?.code, 'ERR_BUILD_STATE_LOCK_UNAVAILABLE');
    assert.equal(result?.retryable, true);
    assert.equal(result?.buildState?.retryable, true);
    assert.equal(result?.buildState?.reason, 'lock-unavailable');
    assert.equal(result?.buildState?.lockOwner?.pid, process.pid);
    assert.equal(result?.buildState?.lockOwner?.scope, 'build-state-lock-unavailable-test');
    assert.equal(result?.lockOwner?.pid, process.pid);
  } finally {
    await heldLock.release({ force: true });
  }
});

await withTempBuildRoot('poc-build-state-lock-required-', async ({ buildRoot }) => {
  const lockPath = path.join(buildRoot, 'build_state.write.lock');
  const heldLock = await acquireFileLock({
    lockPath,
    waitMs: 0,
    pollMs: 1,
    staleMs: 30000,
    timeoutBehavior: 'null',
    metadata: { scope: 'build-state-lock-required-test' }
  });
  assert.ok(heldLock);
  try {
    await assert.rejects(
      applyStatePatch(
        buildRoot,
        {
          heartbeat: {
            stage: 'test',
            lastHeartbeatAt: new Date().toISOString()
          }
        },
        [],
        { durabilityClass: BUILD_STATE_DURABILITY_CLASS.REQUIRED }
      ),
      (error) => {
        assert.equal(error?.code, 'ERR_BUILD_STATE_LOCK_UNAVAILABLE');
        assert.equal(error?.retryable, true);
        assert.equal(error?.buildState?.durabilityClass, BUILD_STATE_DURABILITY_CLASS.REQUIRED);
        assert.equal(error?.buildState?.lockOwner?.pid, process.pid);
        assert.equal(error?.buildState?.lockOwner?.scope, 'build-state-lock-required-test');
        assert.equal(error?.lockOwner?.pid, process.pid);
        assert.match(error?.message || '', /owner: pid=/);
        return true;
      }
    );
  } finally {
    await heldLock.release({ force: true });
  }
});

await withTempBuildRoot('poc-build-state-logs-', async ({ tempRoot, buildRoot }) => {
  const eventsPath = path.join(buildRoot, 'build_state.events.jsonl');
  const deltasPath = path.join(buildRoot, 'build_state.deltas.jsonl');
  const event = { type: 'checkpoint', stage: 'stage1', ts: '2026-03-12T00:00:00.000Z' };
  const patch = {
    currentPhase: 'processing',
    progress: {
      code: {
        processed: 1,
        total: 2
      }
    }
  };

  await initBuildState({
    buildRoot,
    buildId: 'state-log-behavior',
    repoRoot: tempRoot,
    modes: ['code'],
    stage: 'stage1',
    configHash: 'cfg',
    toolVersion: 'test',
    repoProvenance: { provider: 'none' },
    signatureVersion: 1
  });

  await applyStatePatch(buildRoot, patch, [event]);
  await applyStatePatch(buildRoot, patch, [event]);

  let [eventsText, deltasText] = await Promise.all([
    fs.readFile(eventsPath, 'utf8'),
    fs.readFile(deltasPath, 'utf8')
  ]);
  assert.equal(eventsText.trim().split('\n').length, 2);
  assert.ok(deltasText.trim().split('\n').length >= 2);

  await fs.rm(eventsPath, { force: true });
  await fs.rm(deltasPath, { force: true });
  await applyStatePatch(buildRoot, patch, [event]);

  [eventsText, deltasText] = await Promise.all([
    fs.readFile(eventsPath, 'utf8'),
    fs.readFile(deltasPath, 'utf8')
  ]);
  assert.match(eventsText, /"type":"checkpoint"/);
  assert.match(deltasText, /"op":"snapshot"/);
  assert.match(deltasText, /"path":"\/currentPhase"/);
});

await withTempBuildRoot('poc-build-state-skip-write-', async ({ tempRoot, buildRoot }) => {
  const statePath = path.join(buildRoot, 'build_state.json');
  const progressPath = path.join(buildRoot, 'build_state.progress.json');

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
  assert.equal(state.stage, 'stage1');
  assert.equal(progress.code.processed, 1);
});

console.log('indexing state build state contract matrix test passed');
