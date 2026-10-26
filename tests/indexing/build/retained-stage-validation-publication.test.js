#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/build-index/index.js';
import { createSemanticEnrichmentGrant } from '../../../src/index/semantic/enrichment-context.js';
import { getRepoCacheRoot } from '../../../src/shared/dict-utils.js';
import { verifyCompletedStage } from '../../../src/index/build/completed-stage.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { publishStageDirectoryFixture } from '../../helpers/stage-directory-fixture.js';
import { updatePieceManifest } from '../../../tools/build/embeddings/manifest.js';
import { writeArtifactPublicationValidationReport, writeArtifactPublicationRecord } from '../../../src/index/build/artifact-publication.js';
import { setProgressHandlers } from '../../../src/shared/progress-runtime.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-retained-validation-'));
try {
  const root = path.join(directory, 'repo');
  await fs.mkdir(root);
  const sourcePath = path.join(root, 'tiny.js');
  await fs.writeFile(sourcePath, 'export function value() { return 1; }\n');
  applyTestEnv({ cacheRoot: path.join(directory, 'cache'), embeddings: 'off',
    extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null },
    testConfig: createFastIndexingTestConfig({ threads: 1, sqlite: { use: false },
      indexing: { workerPool: { enabled: false }, embeddings: { enabled: false, mode: 'off', lancedb: { enabled: false } } } }) });
  let retainedRoot = null, retainedId = null;
  const failure = Object.assign(new Error('injected after complete Stage2 and before publication'), { code: 'ERR_FIXTURE_BEFORE_PUBLISH' });
  const grant = createSemanticEnrichmentGrant({ attach: async runtime => {
    retainedRoot = runtime.buildRoot; retainedId = runtime.buildId;
    return { beforePublish: async () => { throw failure; } };
  } });
  await assert.rejects(buildIndex(root, { mode: 'code', stage: 'stage2', sqlite: false,
    progress: 'off', semanticEnrichmentDrain: grant }), { code: failure.code });
  const seal = await verifyCompletedStage({ buildRoot: retainedRoot, buildId: retainedId, repoRoot: root, mode: 'code' });
  assert.ok(seal.output.pieces > 0);
  assert.ok(seal.sourceSnapshot?.identity, 'normal preprocessing supplies the existing exact source identity');
  const pointer = path.join(getRepoCacheRoot(root), 'builds/current.json');
  await assert.rejects(fs.stat(pointer), { code: 'ENOENT' });
  // Native decoding is a separate opt-in qualification. This named closed-writer
  // fixture uses the real directory publication/manifest/recovery owners.
  const outDir = path.join(retainedRoot, 'index-code'), manifestPath = path.join(outDir, 'pieces/manifest.json');
  const backend = await publishStageDirectoryFixture({ outDir });
  const priorValidation = JSON.parse(await fs.readFile(path.join(retainedRoot, 'artifact-publication.code.validation.json'), 'utf8'));
  const refreshPublication = async () => {
    await updatePieceManifest({ indexDir: outDir, mode: 'code', totalChunks: 1, dims: 2,
      backendPieces: backend.pieces, embeddingGeneration: 'a'.repeat(64) });
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const publicationValidation = await writeArtifactPublicationValidationReport({ buildRoot: retainedRoot, outDir,
      mode: 'code', buildId: retainedId, manifestPath, pieceEntries: manifest.pieces, familyDeclarations: priorValidation.families });
    assert.equal(publicationValidation.payload.ok, true);
    await writeArtifactPublicationRecord({ buildRoot: retainedRoot, outDir, mode: 'code', buildId: retainedId,
      manifestPath, pieceEntries: manifest.pieces, publicationValidation });
  };
  const metadataBytes = await fs.readFile(backend.metadataPath), metadata = JSON.parse(metadataBytes);
  await fs.writeFile(backend.metadataPath, JSON.stringify({ ...metadata, embeddingGeneration: 'b'.repeat(64) }));
  await refreshPublication();
  const invalidPlan = await buildIndex(root, { recovery: { action: 'inspect', indexRoot: retainedRoot, operation: 'publish' } });
  await assert.rejects(buildIndex(root, { recovery: { action: 'execute', plan: invalidPlan } }), { code: 'ERR_COMPLETED_STAGE_INVALID' });
  await assert.rejects(fs.stat(pointer), { code: 'ENOENT' }, 'directory receipt failure is discovered before pointer commit');
  await fs.writeFile(backend.metadataPath, metadataBytes); await refreshPublication();
  const plan = await buildIndex(root, { recovery: { action: 'inspect', indexRoot: retainedRoot, operation: 'publish' } });
  assert.equal(plan.work.parseFiles, 0);
  assert.equal(plan.sourceScope, 'retained-historical-snapshot');
  const open = fs.open, readFile = fs.readFile;
  let sourceReads = 0;
  const isSource = filename => path.relative(path.resolve(String(filename)), sourcePath) === '';
  fs.open = async function (filename, ...args) { if (isSource(filename)) sourceReads++; return open.call(this, filename, ...args); };
  fs.readFile = async function (filename, ...args) { if (typeof filename === 'string' && isSource(filename)) sourceReads++; return readFile.call(this, filename, ...args); };
  let recovered;
  try { recovered = await buildIndex(root, { recovery: { action: 'execute', plan } }); }
  finally { fs.open = open; fs.readFile = readFile; }
  assert.equal(sourceReads, 0, 'publication retry must never rerun parsing or preprocessing');
  assert.equal(recovered.publication.status, 'published');
  assert.deepEqual(recovered.work, { parsedFiles: 0, embeddedFiles: 0, rebuiltArtifacts: 0 });
  assert.equal(JSON.parse(await fs.readFile(pointer)).buildId, retainedId);
  const state = JSON.parse(await fs.readFile(path.join(retainedRoot, 'build_state.json')));
  assert.equal(state.phases.promote.status, 'failed', 'original failed attempt is historical evidence');
  assert.equal(state.runtime.attempts.find(attempt => attempt.attemptId === seal.originatingAttemptId).lifecycle, 'failed');
  assert.equal(state.runtime.attempts.at(-1).lifecycle, 'succeeded');
  assert.ok(state.recoveryTransactions[plan.planId].outputIdentities[0].output.pieces > seal.output.pieces,
    'durable completion retains the pre-admitted final directory family as well as the original Stage2 output');
  const pointerAfterRecovery = await fs.readFile(pointer, 'utf8');
  const repeated = await buildIndex(root, { recovery: { action: 'execute', plan } });
  assert.equal(repeated.alreadyComplete, true);
  assert.equal(repeated.runtimeAttemptId, recovered.runtimeAttemptId);
  assert.equal(await fs.readFile(pointer, 'utf8'), pointerAfterRecovery, 'repeated reviewed publication must not rewrite the pointer');
  const republish = await buildIndex(root, { recovery: { action: 'inspect', indexRoot: retainedRoot, operation: 'publish' } });
  const restore = setProgressHandlers({ log: message => {
    if (message === '[build] updated current.json') throw new Error('injected post-commit notification failure');
  } });
  try {
    await assert.rejects(buildIndex(root, { recovery: { action: 'execute', plan: republish } }), error => {
      assert.equal(error.code, 'ERR_RECOVERY_POST_COMMIT');
      assert.equal(error.publication.status, 'published');
      assert.equal(error.publication.buildRoot, retainedRoot);
      assert.equal(error.publication.buildId, retainedId);
      assert.equal(error.publication.sourceBuildRoot, retainedRoot);
      assert.equal(error.publication.recoveryPlanId, republish.planId);
      assert.equal(typeof error.publication.runtimeAttemptId, 'string');
      assert.equal(error.outcome.publication.status, 'published');
      return true;
    });
  } finally { restore(); }
  assert.equal(JSON.parse(await fs.readFile(pointer)).buildId, retainedId);
} finally { await fs.rm(directory, { recursive: true, force: true }); }
console.log('retained completed Stage2 publication performs validation without recomputation');
