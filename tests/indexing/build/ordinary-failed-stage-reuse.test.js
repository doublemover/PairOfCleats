#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/build-index/index.js';
import { readCompletedStage } from '../../../src/index/build/completed-stage.js';
import { createSemanticEnrichmentGrant } from '../../../src/index/semantic/enrichment-context.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ordinary-reuse-'));
try {
  applyTestEnv({ cacheRoot: path.join(directory, 'cache'), embeddings: 'off',
    extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null },
    testConfig: createFastIndexingTestConfig({ threads: 1, sqlite: { use: false },
      indexing: { workerPool: { enabled: false }, semantic: { enabled: false }, embeddings: { enabled: false, mode: 'off' } } }) });
  const root = path.join(directory, 'repo');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'tiny.js'), 'export const value = 1;\n');
  let retainedRoot, retainedId;
  const grant = createSemanticEnrichmentGrant({ attach: async runtime => {
    retainedRoot = runtime.buildRoot; retainedId = runtime.buildId;
    return { beforePublish: async () => { throw Object.assign(new Error('injected optional closeout failure'), { code: 'ERR_FIXTURE_RETAINED' }); } };
  } });
  await assert.rejects(buildIndex(root, { mode: 'code', stage: 'stage2', progress: 'off', semanticEnrichmentDrain: grant }),
    { code: 'ERR_FIXTURE_RETAINED' });
  const original = await readCompletedStage({ buildRoot: retainedRoot, mode: 'code' });
  assert.equal(original.sourceValidation.status, 'verified');
  const candidates = await buildIndex(root, { recovery: { action: 'candidates', modes: ['code'] } });
  assert.equal(candidates.candidates.length, 1);
  assert.equal(candidates.candidates[0].buildId, retainedId);
  const result = await buildIndex(root, { mode: 'code', stage: 'stage2', progress: 'off' });
  assert.equal(result.buildId, retainedId, 'ordinary requested build can retain the exact failed generation');
  assert.equal(result.reuseDecision.disposition, 'reused');
  assert.equal(result.completedStageWork.code.status, 'reused');
  assert.equal(result.completedStageWork.code.parsedFiles, 0);
  assert.equal(result.recovery.work.parsedFiles, 0);
  assert.equal(result.outcome.status, 'index-published');
  assert.equal((await readCompletedStage({ buildRoot: retainedRoot, mode: 'code' })).snapshot.relativeRoot, original.snapshot.relativeRoot);
  const comparison = await buildIndex(root, { compareAttempts: {
    before: { buildRoot: retainedRoot, attemptId: original.originatingAttemptId },
    after: { buildRoot: retainedRoot, attemptId: result.runtimeAttemptId }
  } });
  assert.equal(comparison.comparison.changes.find(change => change.field === 'sourceIdentity').status, 'unchanged');
  const work = comparison.comparison.changes.find(change => change.field === 'completedStageWork');
  assert.equal(work.before.code.status, 'sealed');
  assert.equal(work.after.code.status, 'reused');
  assert.equal(work.after.code.parsedFiles, 0);
  assert.equal((await buildIndex(root, { recovery: { action: 'inspect', operation: 'resume', indexRoot: retainedRoot } })).blocked,
    'selected-generation-is-current-and-cannot-be-mutated');
  await assert.rejects(buildIndex(root, { mode: 'code', stage: 'stage2', buildRecoveryGrant: {}, progress: 'off' }),
    { code: 'ERR_RECOVERY_AUTHORITY' }, 'serialized options cannot fabricate a borrowed writer capability');
  await fs.writeFile(path.join(root, 'tiny.js'), 'export const value = 2;\n');
  await assert.rejects(buildIndex(root, { mode: 'code', stage: 'stage2', progress: 'off', semanticEnrichmentDrain: grant }),
    { code: 'ERR_FIXTURE_RETAINED' });
  const changedCandidate = retainedId;
  await fs.writeFile(path.join(root, 'tiny.js'), 'export const value = 3;\n');
  const recomputed = await buildIndex(root, { mode: 'code', stage: 'stage2', progress: 'off' });
  assert.notEqual(recomputed.buildId, changedCandidate);
  assert.equal(recomputed.completedStageWork.code.status, 'sealed');
  const recomputedState = JSON.parse(await fs.readFile(path.join(recomputed.buildRoot, 'build_state.json')));
  const decision = recomputedState.runtime.attempts.at(-1).inputs.executionPlan.reuseDecision;
  assert.equal(decision.candidateRefused, true);
  assert.equal(decision.reason, 'source-or-discovery-snapshot-changed');
} finally { await fs.rm(directory, { recursive: true, force: true }); }
console.log('ordinary retry reuses a compatible completed Stage2 under canonical writer and publication owners');
