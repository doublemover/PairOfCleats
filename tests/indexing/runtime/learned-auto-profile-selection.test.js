#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  learnedAutoProfileInternals,
  resolveLearnedAutoProfileSelection
} from '../../../src/index/build/runtime/learned-auto-profile.js';
import { applyLearnedAutoProfileSelection } from '../../../src/index/build/runtime/runtime.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-learned-auto-profile-'));
const repoRoot = path.join(tempRoot, 'repo');
const repoCacheRoot = path.join(tempRoot, 'repo-cache');

await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(repoRoot, 'src', 'main.js'), 'export function main() { return 42; }\n');
await fs.writeFile(path.join(repoRoot, 'README.md'), '# tiny repo\n');

applyTestEnv({ cacheRoot: tempRoot });

const shadowResult = await resolveLearnedAutoProfileSelection({
  root: repoRoot,
  repoCacheRoot,
  indexingConfig: {
    autoProfile: {
      enabled: true,
      shadowOnly: true,
      minConfidence: 0.7,
      maxScanEntries: 200
    }
  }
});

assert.equal(shadowResult.enabled, true, 'shadow run should be enabled');
assert.equal(shadowResult.profileId, 'latency', 'tiny repo should select latency profile');
assert.equal(shadowResult.shadowOnly, true, 'shadow config should be preserved');
assert.equal(shadowResult.applied, false, 'shadow mode should not apply overrides');
assert.equal(shadowResult.eligible, true, 'shadow mode should still compute eligibility');
assert.ok(shadowResult.suggestion?.tinyRepoFastPath, 'shadow mode should emit suggestion payload');

const appliedResult = await resolveLearnedAutoProfileSelection({
  root: repoRoot,
  repoCacheRoot,
  indexingConfig: {
    autoProfile: {
      enabled: true,
      shadowOnly: false,
      minConfidence: 0.5,
      maxScanEntries: 200
    }
  }
});

assert.equal(appliedResult.applied, true, 'low confidence gate should apply latency overrides');
assert.ok(appliedResult.overrides?.tinyRepoFastPath, 'applied result should include overrides');
assert.equal(appliedResult.state.persisted, true, 'state should persist when cache root is writable');

const gatedResult = await resolveLearnedAutoProfileSelection({
  root: repoRoot,
  repoCacheRoot,
  indexingConfig: {
    autoProfile: {
      enabled: true,
      shadowOnly: false,
      minConfidence: 0.99,
      maxScanEntries: 200
    }
  }
});

assert.equal(gatedResult.applied, false, 'confidence gate should block low-confidence apply');
assert.equal(gatedResult.eligible, false, 'confidence gate should mark selection ineligible');
assert.ok(gatedResult.suggestion?.tinyRepoFastPath, 'gated result should still provide suggestion');

const baseIndexingConfig = {
  shards: { enabled: true, maxWorkers: 2 },
  tinyRepoFastPath: { enabled: false }
};
const mergedConfig = applyLearnedAutoProfileSelection({
  indexingConfig: baseIndexingConfig,
  learnedAutoProfile: appliedResult
});
assert.equal(mergedConfig.tinyRepoFastPath.enabled, true, 'runtime application should merge applied overrides');
assert.equal(mergedConfig.shards.enabled, false, 'runtime application should honor override changes');

const unmergedConfig = applyLearnedAutoProfileSelection({
  indexingConfig: baseIndexingConfig,
  learnedAutoProfile: gatedResult
});
assert.deepEqual(unmergedConfig, baseIndexingConfig, 'runtime application should ignore non-applied selections');

const statePath = learnedAutoProfileInternals.resolveStatePath(repoCacheRoot);
await fs.mkdir(path.dirname(statePath), { recursive: true });
await fs.writeFile(statePath, '{broken-json');

const recoveredResult = await resolveLearnedAutoProfileSelection({
  root: repoRoot,
  repoCacheRoot,
  indexingConfig: {
    autoProfile: {
      enabled: true,
      shadowOnly: false,
      minConfidence: 0.5,
      maxScanEntries: 200
    }
  }
});

assert.equal(recoveredResult.state.recovered, true, 'corrupt persisted state should be recovered');
assert.equal(recoveredResult.state.persisted, true, 'recovered state should be rewritten');

const persistedState = JSON.parse(await fs.readFile(statePath, 'utf8'));
const rootIdentity = learnedAutoProfileInternals.resolveRootIdentity(repoRoot);
assert.equal(persistedState.schemaVersion, '1.0.0', 'state schema version should be stable');
assert.equal(
  persistedState?.profiles?.[rootIdentity]?.profileId,
  recoveredResult.profileId,
  'persisted state should track current root identity'
);

const badRepoCacheRoot = path.join(tempRoot, 'not-a-directory');
await fs.writeFile(badRepoCacheRoot, 'block-dir-creation');

const persistenceFallback = await resolveLearnedAutoProfileSelection({
  root: repoRoot,
  repoCacheRoot: badRepoCacheRoot,
  indexingConfig: {
    autoProfile: {
      enabled: true,
      shadowOnly: false,
      minConfidence: 0.5,
      maxScanEntries: 200
    }
  }
});

assert.equal(persistenceFallback.enabled, true, 'selection should still resolve when persistence fails');
assert.equal(
  persistenceFallback.state.persisted,
  false,
  'selection should surface non-fatal state persistence failures'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('learned auto-profile selection test passed');
