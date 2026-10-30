#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { validateBuildState } from '../../../src/contracts/validators/build-state.js';
import { initBuildState, markBuildPhase } from '../../../src/index/build/build-state.js';
import { getBuildsRoot, getRepoCacheRoot } from '../../../src/shared/dict-utils.js';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { createIndexCacheLease } from '../../../src/index/build/cache-lease.js';
import { sealCompletedStage, verifyCompletedStage } from '../../../src/index/build/completed-stage.js';
import { writeArtifactPublicationRecord, writeArtifactPublicationValidationReport } from '../../../src/index/build/artifact-publication.js';
import { planBuildRecovery, executeBuildRecovery } from '../../../src/integrations/core/build-index/recovery.js';
import { buildIndex } from '../../../src/integrations/core/build-index/index.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-completed-stage-'));
try {
  const root = path.join(directory, 'repo');
  await fs.mkdir(root);
  const userConfig = { cache: { root: path.join(directory, 'cache') }, sqlite: { use: false } };
  applyTestEnv({ cacheRoot: userConfig.cache.root, testConfig: { sqlite: { use: false } },
    extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
  await fs.writeFile(path.join(root, '.pairofcleats.json'), JSON.stringify({ cache: userConfig.cache }));
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const buildRoot = path.join(getBuildsRoot(root, userConfig), 'generation');
  const outDir = path.join(buildRoot, 'index-code');
  await fs.mkdir(path.join(outDir, 'pieces'), { recursive: true });
  await fs.writeFile(path.join(outDir, 'chunk_meta.json'), '[]');
  const pieces = [{ name: 'chunk_meta', path: 'chunk_meta.json', format: 'json', bytes: 2, count: 0 }];
  const manifestPath = path.join(outDir, 'pieces/manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify({ version: 2, mode: 'code', buildId: 'generation',
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces }));
  await initBuildState({ buildRoot, buildId: 'generation', repoRoot: root, stage: 'stage2', modes: ['code'] });
  await markBuildPhase(buildRoot, 'stage3', 'failed', { reason: 'injected embedding failure' });
  const publicationValidation = await writeArtifactPublicationValidationReport({ buildRoot, outDir, mode: 'code',
    buildId: 'generation', pieceEntries: pieces, manifestPath,
    familyDeclarations: [{ family: 'fixture', owner: 'fixture', requiredMembers: ['chunk_meta'] }] });
  await writeArtifactPublicationRecord({ buildRoot, outDir, mode: 'code', buildId: 'generation',
    pieceEntries: pieces, manifestPath, publicationValidation });
  const lock = await acquireIndexLock({ repoCacheRoot, requireSettlement: true });
  const lease = createIndexCacheLease(lock, repoCacheRoot);
  const runtime = { root, buildRoot, buildId: 'generation', repoCacheRoot, cacheWriterLease: lease,
    runtimeAttempt: { attemptId: 'original-attempt' }, configHash: 'config' };
  const completion = await sealCompletedStage({ runtime, mode: 'code' });
  assert.equal(completion.output.pieces, 1);
  assert.equal(completion.output.bytes, 2);
  assert.equal(completion.originatingAttemptId, 'original-attempt');
  const sealedState = JSON.parse(await fs.readFile(path.join(buildRoot, 'build_state.json'), 'utf8'));
  const checkState = completed => validateBuildState({ ...sealedState, completedStages: { code: completed } });
  assert.equal(checkState(completion).ok, true, JSON.stringify(checkState(completion)));
  const unobserved = { ...completion, producer: { schemaVersion: 1, identity: null, reason: 'fixture-unavailable' } };
  assert.equal(checkState(unobserved).ok, true);
  const missingReason = structuredClone(unobserved); delete missingReason.producer.reason;
  assert.equal(checkState(missingReason).ok, false, 'unobserved producer identity requires its reason');
  const observed = { ...completion, producer: { schemaVersion: 1, identity: 'a'.repeat(64), revision: 'fixture',
    dirty: 'b'.repeat(64), dirtyFiles: 0, bootstrap: 'c'.repeat(64), node: process.version,
    signatureVersion: 1, analysisVersions: {}, evidenceScope: 'observed-implementation-files-and-bootstrap-receipt' },
  sourceValidation: { status: 'verified', reason: 'fixture', files: 0, algorithm: 'sha1', identity: 'd'.repeat(64) } };
  assert.equal(checkState(observed).ok, true);
  const missingBootstrap = structuredClone(observed); delete missingBootstrap.producer.bootstrap;
  assert.equal(checkState(missingBootstrap).ok, false, 'observed producer identity retains every conditional requirement');
  const missingSourceIdentity = structuredClone(observed); delete missingSourceIdentity.sourceValidation.identity;
  assert.equal(checkState(missingSourceIdentity).ok, false, 'verified source observations require their identity');
  await lock.release();
  lease.invalidate();
  assert.equal((await verifyCompletedStage({ root, repoRoot: root, buildRoot, buildId: 'generation', mode: 'code' })).output.contentHash,
    completion.output.contentHash);
  await fs.writeFile(path.join(outDir, 'chunk_meta.json'), '{}');
  await assert.rejects(verifyCompletedStage({ repoRoot: root, buildRoot, buildId: 'generation', mode: 'code' }),
    error => error.code === 'ERR_COMPLETED_STAGE_INVALID' && error.cause?.code === 'ERR_ARTIFACT_PUBLICATION_INTEGRITY',
    'same-size retained mutations cannot survive the content seal, retaining its exact publication-integrity cause');
  await fs.writeFile(path.join(outDir, 'chunk_meta.json'), '[]');
  await assert.rejects(verifyCompletedStage({ repoRoot: directory, buildRoot, buildId: 'generation', mode: 'code' }),
    { code: 'ERR_COMPLETED_STAGE_INVALID' });
  await assert.rejects(sealCompletedStage({ runtime, mode: 'code' }), { code: 'ERR_INDEX_CACHE_OWNERSHIP' });

  const statePath = path.join(buildRoot, 'build_state.json');
  const beforeState = await fs.readFile(statePath, 'utf8');
  const plan = await planBuildRecovery({ root, userConfig, indexRoot: buildRoot });
  assert.equal(plan.work.parseFiles, 0);
  assert.equal(plan.work.generateEmbeddings, false);
  assert.equal(plan.work.publishCurrentPointer, false);
  assert.equal(plan.modeEvidence[0].status, 'sealed-unverified');
  assert.equal(await fs.readFile(statePath, 'utf8'), beforeState, 'inspection must preserve failure evidence');
  await assert.rejects(fs.stat(path.join(getBuildsRoot(root, userConfig), 'current.json')), { code: 'ENOENT' });
  await assert.rejects(planBuildRecovery({ root, userConfig, indexRoot: path.join(getBuildsRoot(root, userConfig), 'missing') }),
    { code: 'ERR_RECOVERY_GENERATION_MISSING' }, 'an exact absent selector must never select current/latest');
  await assert.rejects(executeBuildRecovery({ root, userConfig: { ...userConfig, sqlite: { use: true } }, plan }),
    { code: 'ERR_RECOVERY_PLAN_STALE' });
  await assert.rejects(executeBuildRecovery({ root, userConfig, plan: { ...plan, operation: 'publish' } }),
    { code: 'ERR_RECOVERY_PLAN_STALE' });
  const held = await acquireIndexLock({ repoCacheRoot, requireSettlement: true });
  const blocked = await planBuildRecovery({ root, userConfig, indexRoot: buildRoot });
  assert.equal(blocked.blocked, 'repository-writer-lease-present');
  await assert.rejects(executeBuildRecovery({ root, userConfig, plan: blocked }), { code: 'ERR_RECOVERY_BUSY' });
  await held.release();

  const corePlan = await buildIndex(root, { recovery: { action: 'inspect', indexRoot: buildRoot, operation: 'validate' } });
  assert.equal(corePlan.operation, 'validate');
  assert.equal(corePlan.outcome, undefined, 'read-only inspection is not a completed build stage');
  const originalOpen = fs.open;
  const sourcePath = path.join(root, 'never-parse.js');
  await fs.writeFile(sourcePath, 'throw new Error("no parser in recovery")');
  let sourceReads = 0;
  fs.open = async function (filename, ...args) {
    if (path.resolve(String(filename)) === sourcePath) sourceReads++;
    return originalOpen.call(this, filename, ...args);
  };
  try {
    await assert.rejects(executeBuildRecovery({ root, userConfig, plan: await planBuildRecovery({ root, userConfig, indexRoot: buildRoot }) }),
      { code: 'ERR_RECOVERY_VALIDATION' }, 'missing ordinary artifacts fail required validation');
  } finally { fs.open = originalOpen; }
  assert.equal(sourceReads, 0);
  const after = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(after.phases.stage3.status, 'failed');
  assert.equal(after.runtime.attempts.at(-1).lifecycle, 'failed');
  await assert.rejects(fs.stat(path.join(getBuildsRoot(root, userConfig), 'current.json')), { code: 'ENOENT' });
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
console.log('completed stage sealing and retained recovery test passed');
