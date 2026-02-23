#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  resolvePostingsBuildResult,
  runWriteStageWithIncrementalBundles
} from '../../../src/index/build/indexer/pipeline/phase-ordering.js';

applyTestEnv();

{
  let runCount = 0;
  const postings = await resolvePostingsBuildResult({
    postingsPromise: Promise.resolve({ source: 'overlap' }),
    runPostingsBuild: async () => {
      runCount += 1;
      return { source: 'stage-boundary' };
    }
  });
  assert.equal(postings.source, 'overlap', 'expected overlap promise result to win');
  assert.equal(runCount, 0, 'expected no fallback postings build when overlap exists');
}

{
  let runCount = 0;
  const postings = await resolvePostingsBuildResult({
    postingsPromise: null,
    runPostingsBuild: async () => {
      runCount += 1;
      return { source: 'stage-boundary' };
    }
  });
  assert.equal(postings.source, 'stage-boundary', 'expected stage-boundary postings build result');
  assert.equal(runCount, 1, 'expected fallback postings build exactly once');
}

{
  const events = [];
  await runWriteStageWithIncrementalBundles({
    writeArtifacts: async () => {
      events.push('write');
    },
    runtime: { incrementalEnabled: true },
    mode: 'code',
    crossFileEnabled: true,
    incrementalBundleVfsRowsPromise: Promise.resolve({ rowCount: 3 }),
    updateIncrementalBundles: async ({ existingVfsManifestRowsByFile }) => {
      events.push(`bundle:${existingVfsManifestRowsByFile?.rowCount || 0}`);
    },
    incrementalState: {},
    state: {},
    log: () => {}
  });
  assert.deepEqual(
    events,
    ['write', 'bundle:3'],
    'expected write completion before incremental bundle synchronization'
  );
}

{
  const events = [];
  await runWriteStageWithIncrementalBundles({
    writeArtifacts: async () => {
      events.push('write');
    },
    runtime: { incrementalEnabled: false },
    mode: 'code',
    crossFileEnabled: true,
    incrementalBundleVfsRowsPromise: Promise.resolve({ rowCount: 99 }),
    updateIncrementalBundles: async () => {
      events.push('bundle');
    },
    incrementalState: {},
    state: {},
    log: () => {}
  });
  assert.deepEqual(events, ['write'], 'expected incremental sync skipped when runtime disables it');
}

console.log('phase ordering sequencing test passed');
