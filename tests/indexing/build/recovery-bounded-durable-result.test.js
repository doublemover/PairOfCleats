#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/build-index/index.js';
import { executeBuildRecovery } from '../../../src/integrations/core/build-index/recovery.js';
import { MAX_DURABLE_RECOVERY_RESULT_BYTES } from '../../../src/integrations/core/build-index/recovery-result.js';
import { getRepoCacheRoot, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { readIndexLockInfo } from '../../../src/index/build/lock.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-recovery-bounded-result-'));
let retainedWriter = null, childSettled = false, inspectionSettled = false;
try {
  const root = path.join(directory, 'repo');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'tiny.js'), 'export const value = 1;\n');
  applyTestEnv({ cacheRoot: path.join(directory, 'cache'), embeddings: 'off',
    extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null },
    testConfig: createFastIndexingTestConfig({ threads: 1, sqlite: { use: false },
      indexing: { workerPool: { enabled: false }, semantic: { enabled: false }, embeddings: { enabled: false, mode: 'off' } } }) });
  const original = await buildIndex(root, { mode: 'code', stage: 'stage2', progress: 'off' });
  const plan = await buildIndex(root, { recovery: { action: 'inspect', indexRoot: original.buildRoot,
    operation: 'refresh', resumeTarget: 'stage2', modes: ['code'] } });
  const diagnostic = 'original backend diagnostic evidence '.repeat(32768);
  const result = await executeBuildRecovery({ root, userConfig: loadUserConfig(root), plan,
    resumeBuild: async (grant, request) => ({ ...await buildIndex(root, { ...request, progress: 'off', buildRecoveryGrant: grant }), diagnostic }) });
  assert.equal(result.execution.diagnostic, diagnostic, 'the immediate caller retains its full actual execution response');
  assert.equal(result.executionEvidence.buildRoot, result.buildRoot);
  assert.equal(result.executionEvidence.attemptId, result.runtimeAttemptId);
  assert.equal(result.publication.buildRoot, result.buildRoot);
  assert.notEqual(result.buildRoot, original.buildRoot);
  const stateText = await fs.readFile(path.join(original.buildRoot, 'build_state.json'), 'utf8');
  const transaction = JSON.parse(stateText).recoveryTransactions[plan.planId];
  assert.equal(transaction.status, 'completed');
  assert.equal(Object.hasOwn(transaction.result, 'execution'), false, 'durable transactions link existing execution evidence without copying raw backend output');
  assert.equal(Buffer.byteLength(JSON.stringify(transaction.result)) <= MAX_DURABLE_RECOVERY_RESULT_BYTES, true);
  assert.equal(stateText.includes(diagnostic), false);
  assert.deepEqual(transaction.result.executionEvidence, result.executionEvidence);
  const repeated = await buildIndex(root, { recovery: { action: 'execute', plan } });
  assert.equal(repeated.alreadyComplete, true);
  assert.equal(repeated.buildId, result.buildId);
  assert.deepEqual(repeated.work, result.work);
  assert.deepEqual(repeated.executionEvidence, result.executionEvidence);
  const failedPlan = await buildIndex(root, { recovery: { action: 'inspect', indexRoot: result.buildRoot,
    operation: 'clean', resumeTarget: 'stage2', modes: ['code'] } });
  const inspector = Object.assign(new Error('original recovery diagnostic inspector owns work'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => inspectionSettled
  });
  const failure = Object.defineProperty({ cacheOwnershipPending: true,
    cacheOwnershipReleased: () => childSettled }, 'code', { configurable: true, get() { throw inspector; } });
  await assert.rejects(executeBuildRecovery({ root, userConfig: loadUserConfig(root), plan: failedPlan,
    resumeBuild: async () => { throw failure; } }), error => {
    retainedWriter = error;
    return typeof error.releaseRecoveryWriter === 'function';
  });
  assert.ok(await readIndexLockInfo(getRepoCacheRoot(root)));
  failure.cacheOwnershipPending = false;
  failure.cacheOwnershipReleased = () => true;
  Object.defineProperty(failure, 'code', { value: 'REPLACEMENT_CODE', configurable: true });
  await assert.rejects(retainedWriter.releaseRecoveryWriter());
  childSettled = true;
  await assert.rejects(retainedWriter.releaseRecoveryWriter(), 'the original inspector remains an independent writer-release prerequisite');
  inspectionSettled = true;
  assert.equal(await retainedWriter.releaseRecoveryWriter(), true);
  assert.equal(await readIndexLockInfo(getRepoCacheRoot(root)), null);
  retainedWriter = null;
} finally {
  childSettled = true; inspectionSettled = true;
  if (retainedWriter) await retainedWriter.releaseRecoveryWriter();
  await fs.rm(directory, { recursive: true, force: true });
}
console.log('durable recovery completion remains bounded while linking original runtime execution evidence');
