#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initBuildState } from '../../../src/index/build/build-state.js';
import { createRuntimeAttempt } from '../../../src/shared/runtime-envelope/receipt.js';
import { persistRuntimeAttempt } from '../../../src/index/build/build-state/runtime.js';
import { refreshRuntimeReceipt } from '../../../src/index/build/runtime/receipt.js';
import { compareBuildAttempts } from '../../../src/index/build/runtime/compare.js';
import { buildIndex } from '../../../src/integrations/core/build-index/index.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-build-comparison-'));
try {
  const buildRoot = path.join(directory, 'build');
  await initBuildState({ buildRoot, buildId: 'generation', repoRoot: directory, stage: 'stage2', modes: ['code'] });
  const original = await createRuntimeAttempt({ buildId: 'generation', stage: 'stage2' });
  const runtime = { buildRoot, runtimeAttempt: original, stage: 'stage2', configHash: 'effective-config',
    buildSourceSnapshot: { identity: 'same-source', policyKey: 'ignore-policy', candidateCount: 3, capturedSourceBytes: 128 },
    lintEnabled: true, completedStageWork: { code: { status: 'sealed', selectedFiles: 3, processedFiles: null } } };
  await refreshRuntimeReceipt(runtime, { lifecycle: 'failed' });
  const retry = await createRuntimeAttempt({ buildId: 'generation', stage: 'stage2', parentAttemptId: original.attemptId });
  runtime.runtimeAttempt = retry;
  await refreshRuntimeReceipt(runtime, { lifecycle: 'running' });
  let report = compareBuildAttempts(original, retry);
  const row = field => report.changes.find(change => change.field === field);
  assert.equal(row('stage').status, 'unchanged', 'equal effective Stage2 plans do not imply extra analysis from CLI spelling');
  assert.equal(row('sourceIdentity').status, 'unchanged');
  assert.equal(row('toolRevision').status, 'unknown', 'two absent revisions cannot establish exact implementation sameness');
  assert.equal(report.before.partial, true);
  assert.equal(report.after.partial, true);
  const implementationChanged = compareBuildAttempts({ ...original, inputs: { executionPlan: {
    producerIdentity: { identity: 'same-commit-clean-content', bootstrap: 'same-dependencies' } } } },
  { ...retry, inputs: { executionPlan: { producerIdentity: { identity: 'same-commit-dirty-content', bootstrap: 'same-dependencies' } } } });
  assert.equal(implementationChanged.changes.find(change => change.field === 'implementationIdentity').status, 'changed');
  assert.equal(implementationChanged.changes.find(change => change.field === 'dependencyBootstrapIdentity').status, 'unchanged');
  const admittedBefore = { ...original, inputs: { ...original.inputs, learnedAutoProfile: { profile: 'old' } },
    runtime: { ...original.runtime, workers: { tokenize: { configuredMaxWorkers: 4, observedWorkerCount: 2 } } } };
  const admittedAfter = { ...retry, inputs: { ...retry.inputs, learnedAutoProfile: { profile: 'new' } },
    runtime: { ...retry.runtime, workers: { tokenize: { configuredMaxWorkers: 8, observedWorkerCount: 1 } } } };
  const admitted = compareBuildAttempts(admittedBefore, admittedAfter);
  assert.equal(admitted.changes.find(change => change.field === 'sourceIdentity').status, 'unchanged');
  assert.equal(admitted.changes.find(change => change.field === 'learnedPolicy').status, 'changed');
  assert.equal(admitted.changes.find(change => change.field === 'tokenizationConfiguredWorkers').status, 'changed');
  assert.equal(admitted.changes.find(change => change.field === 'tokenizationObservedWorkers').status, 'changed');
  await persistRuntimeAttempt(buildRoot, retry, { runtime: { ...retry.runtime,
    workers: { ...retry.runtime.workers, tokenize: { configuredMaxWorkers: 8, effectiveMaxWorkers: 2,
      observedWorkerCount: 1, completedRequests: 5 }, tokenizationExecution: 'worker-pool' } } });
  report = await buildIndex(directory, { compareAttempts: {
    before: { buildRoot, attemptId: original.attemptId }, after: { buildRoot, attemptId: retry.attemptId }
  } });
  assert.equal(report.outcome, undefined);
  assert.equal(report.comparison.after.attemptId, retry.attemptId);
  assert.equal(report.comparison.changes.find(change => change.field === 'tokenizationObservedWorkers').after, 1);
  assert.equal(report.comparison.changes.find(change => change.field === 'tokenizationConfiguredWorkers').after, 8);
  assert.ok(report.lines.some(line => line.includes('correlations')));
  await assert.rejects(buildIndex(directory, { compareAttempts: {
    before: { buildRoot, attemptId: 'missing' }, after: { buildRoot, attemptId: retry.attemptId }
  } }), { code: 'ERR_BUILD_ATTEMPT_MISSING' });
} finally { await fs.rm(directory, { recursive: true, force: true }); }
console.log('durable build attempt comparison test passed');
