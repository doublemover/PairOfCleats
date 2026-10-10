#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { prepareSemanticBindingWork, reconcilePublishedSemanticBindingWork, persistSemanticAnalysisFrontiers } from '../../../src/index/semantic/build-frontier.js';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { getRepoCacheRoot, getBuildsRoot } from '../../../src/shared/dict-utils.js';
import { createBindingWorkFixture, writeBindingFixtureFamily } from '../../helpers/semantic-binding-work.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';

const fixture = await createBindingWorkFixture();
try {
  const repoCacheRoot = getRepoCacheRoot(fixture.repoRoot, {}), buildsRoot = getBuildsRoot(fixture.repoRoot, {});
  fixture.runtime.repoCacheRoot = repoCacheRoot;
  const priorRoot = path.join(buildsRoot, 'prior');
  await seedPublishedArtifacts({ buildRoot: priorRoot, buildId: 'prior' });
  await promoteBuild({ repoRoot: fixture.repoRoot, userConfig: {}, buildRoot: priorRoot, buildId: 'prior', modes: ['code'] });
  // A source family without frontier work must not even instantiate native control storage.
  const noWorkRoot = path.join(buildsRoot, 'no-frontier-work');
  await fs.cp(fixture.buildRoot, noWorkRoot, { recursive: true });
  const originalBuildRoot = fixture.runtime.buildRoot;
  fixture.runtime.buildRoot = noWorkRoot;
  await writeBindingFixtureFamily({ state: fixture.state, runtime: fixture.runtime, buildId: fixture.generation.baseBuildId });
  assert.deepEqual(await reconcilePublishedSemanticBindingWork({ repoRoot: fixture.repoRoot, buildRoot: noWorkRoot,
    buildId: fixture.generation.baseBuildId, Database: function UnexpectedControlDatabase() {
      throw new Error('A family without frontier work must not open a control database.');
    } }), { status: 'complete', recovered: 0, pending: 0 });
  await assert.rejects(fs.access(path.join(repoCacheRoot, 'semantic-frontier', 'control.sqlite')), { code: 'ENOENT' });
  fixture.runtime.buildRoot = originalBuildRoot;
  const manual = await prepareSemanticBindingWork({ state: fixture.state, runtime: fixture.runtime });
  fixture.runtime.semanticPolicy.enrichment.localFlow = 'deferred';
  const analysisTasks = await persistSemanticAnalysisFrontiers({ state: fixture.state, runtime: fixture.runtime });
  fixture.runtime.semanticPolicy.enrichment.localFlow = 'auto';
  const sourceOnlyRoot = path.join(buildsRoot, fixture.generation.baseBuildId);
  await fs.cp(fixture.buildRoot, sourceOnlyRoot, { recursive: true });
  fixture.runtime.buildRoot = sourceOnlyRoot;
  await writeBindingFixtureFamily({ state: fixture.state, runtime: fixture.runtime, buildId: fixture.generation.baseBuildId });
  await assert.rejects(reconcilePublishedSemanticBindingWork({ repoRoot: fixture.repoRoot,
    buildRoot: sourceOnlyRoot, buildId: fixture.generation.baseBuildId, Database }), { code: 'ERR_SEMANTIC_PUBLICATION_REQUIRED' },
  'unpublished pending descriptors cannot reconstruct control state');
  await promoteBuild({ repoRoot: fixture.repoRoot, userConfig: {}, buildRoot: sourceOnlyRoot,
    buildId: fixture.generation.baseBuildId, modes: ['code'] });
  let control = fixture.openControl();
  try {
    assert.equal(control.getTask(manual.task.taskId).state, 'pending');
    assert.equal(control.getOutput(manual.task.taskId), null);
  } finally { control.close(); }
  const controlPath = path.join(repoCacheRoot, 'semantic-frontier', 'control.sqlite');
  await fs.rm(controlPath);
  const recoveredPending = await reconcilePublishedSemanticBindingWork({ repoRoot: fixture.repoRoot,
    buildRoot: sourceOnlyRoot, buildId: fixture.generation.baseBuildId, Database });
  assert.equal(recoveredPending.pending, 1 + analysisTasks.length, 'source-only published inventory rebuilds durable pending control state');
  await fs.writeFile(controlPath, 'damaged control storage');
  const repairedPending = await reconcilePublishedSemanticBindingWork({ repoRoot: fixture.repoRoot,
    buildRoot: sourceOnlyRoot, buildId: fixture.generation.baseBuildId, Database });
  assert.equal(repairedPending.pending, 1 + analysisTasks.length, 'corrupt control rebuild uses the same verified current publication');
  control = fixture.openControl();
  try {
    assert.deepEqual(control.getDescriptor(manual.task.taskId), manual.task);
    for (const task of analysisTasks) assert.deepEqual(control.getDescriptor(task.taskId), task, 'published analysis descriptors rebuild after control-store loss');
  } finally { control.close(); }
  const sourcePointer = await fs.readFile(path.join(buildsRoot, 'current.json'));
  const originalSource = await fs.readFile(path.join(fixture.repoRoot, fixture.files[0].file));

  // A new generation gets a new pinned request; the old descriptor never changes.
  const nextGeneration = { baseBuildId: 'binding-next', semanticRevision: 0 };
  const nextRoot = path.join(buildsRoot, nextGeneration.baseBuildId);
  await fs.cp(fixture.buildRoot, nextRoot, { recursive: true });
  fixture.runtime.buildRoot = nextRoot;
  fixture.runtime.semanticPolicy.execution.deferredDrain = 'after-index';
  fixture.state.semanticFrontierTargets = [];
  fixture.state.semanticFactsByFile = new Map(fixture.files.map(file => [file.file,
    createSemanticFactsRef({ source: file.source, syntaxPartitionId: file.factsRef.syntaxPartitionId,
      partitions: file.factsRef.partitions, coverage: file.factsRef.coverage,
      storage: { ...file.factsRef.storage, generation: nextGeneration } })]));
  const next = await prepareSemanticBindingWork({ state: fixture.state, runtime: fixture.runtime });
  assert.notEqual(next.task.taskId, manual.task.taskId);
  assert.equal(next.task.policyHash, manual.task.policyHash, 'new target generation alone separates identical binding requests');
  fixture.runtime.semanticEnrichmentDrain={maxMs:30000,admitTask:async({task})=>task.taskId===next.task.taskId};
  const ran = await next.run(fixture.emitBindings);
  assert.equal(ran.ran, true);
  const family = await writeBindingFixtureFamily({ state: fixture.state, runtime: fixture.runtime, buildId: nextGeneration.baseBuildId });
  await assert.rejects(reconcilePublishedSemanticBindingWork({ repoRoot: fixture.repoRoot, buildRoot: nextRoot,
    buildId: nextGeneration.baseBuildId, Database }), { code: 'ERR_SEMANTIC_PUBLICATION_REQUIRED' });
  control = fixture.openControl();
  try { assert.equal(control.getOutput(next.task.taskId), null); } finally { control.close(); }
  await fs.rm(path.join(nextRoot, 'artifact-publication.code.json'));
  await assert.rejects(promoteBuild({ repoRoot: fixture.repoRoot, userConfig: {}, buildRoot: nextRoot,
    buildId: nextGeneration.baseBuildId, modes: ['code'] }), /missing publication record/);
  assert.deepEqual(await fs.readFile(path.join(buildsRoot, 'current.json')), sourcePointer);
  await family.writeRecord();
  await promoteBuild({ repoRoot: fixture.repoRoot, userConfig: {}, buildRoot: nextRoot,
    buildId: nextGeneration.baseBuildId, modes: ['code'] });
  control = fixture.openControl();
  try {
    assert.equal(control.getTask(next.task.taskId).state, 'completed');
    assert.equal(control.getOutput(next.task.taskId).publishedBuildId, nextGeneration.baseBuildId);
    assert.deepEqual(control.getDescriptor(manual.task.taskId), manual.task);
    assert.equal(control.getTask(manual.task.taskId).state, 'pending');
  } finally { control.close(); }
  assert.equal((await reconcilePublishedSemanticBindingWork({ repoRoot: fixture.repoRoot, buildRoot: nextRoot,
    buildId: nextGeneration.baseBuildId, Database })).recovered, 1, 'post-pointer receipt recovery is idempotent');
  await fs.rm(controlPath);
  const reconstructed = await reconcilePublishedSemanticBindingWork({ repoRoot: fixture.repoRoot,
    buildRoot: nextRoot, buildId: nextGeneration.baseBuildId, Database });
  assert.equal(reconstructed.recovered, 1, 'completed output reconstructs after total control-store loss');
  control = fixture.openControl();
  try {
    assert.equal(control.getTask(next.task.taskId).state, 'completed');
    assert.equal(control.getOutput(next.task.taskId).publishedBuildId, nextGeneration.baseBuildId);
    assert.equal(control.getTask(manual.task.taskId), null, 'old unpublished-to-current tasks are not invented');
  } finally { control.close(); }
  await assert.rejects(reconcilePublishedSemanticBindingWork({ repoRoot: fixture.repoRoot,
    buildRoot: sourceOnlyRoot, buildId: fixture.generation.baseBuildId, Database }), { code: 'ERR_SEMANTIC_PUBLICATION_REQUIRED' });
  assert.deepEqual(await fs.readFile(path.join(fixture.repoRoot, fixture.files[0].file)), originalSource);
  console.log('source-only pending recovery, immutable generation requests, failed promotion and publication-before-ack passed');
} finally { await fixture.cleanup(); }
