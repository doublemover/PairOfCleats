#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex, withBuildGraphCapability } from '../../../src/integrations/core/build-index/index.js';
import { buildCodeMap } from '../../../src/map/build-map.js';
import { createSemanticEnrichmentGrant } from '../../../src/index/semantic/enrichment-context.js';
import { readCompletedStage } from '../../../src/index/build/completed-stage.js';
import { getRepoCacheRoot } from '../../../src/shared/dict-utils.js';
import { inspectRepoCacheAccess } from '../../../src/shared/cache/repo-access.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-immutable-graph-'));
try {
  const root = path.join(directory, 'repo');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'tiny.js'), 'export function value() { return 1; }\n');
  applyTestEnv({ cacheRoot: path.join(directory, 'cache'), embeddings: 'off',
    extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null },
    testConfig: createFastIndexingTestConfig({ threads: 1, sqlite: { use: false },
      indexing: { workerPool: { enabled: false }, embeddings: { enabled: false, mode: 'off' } } }) });
  const healthy = await buildIndex(root, { mode: 'code', stage: 'stage2', sqlite: false, progress: 'off' });
  const pointerPath = path.join(getRepoCacheRoot(root), 'builds/current.json');
  const oldPointer = await fs.readFile(pointerPath, 'utf8');
  let retainedRoot, retainedId;
  const grant = createSemanticEnrichmentGrant({ attach: async runtime => {
    retainedRoot = runtime.buildRoot; retainedId = runtime.buildId;
    return { beforePublish: async () => { throw Object.assign(new Error('optional backend failed'), { code: 'ERR_FIXTURE_BACKEND' }); } };
  } });
  await assert.rejects(buildIndex(root, { mode: 'code', stage: 'stage2', sqlite: false,
    progress: 'off', semanticEnrichmentDrain: grant }), { code: 'ERR_FIXTURE_BACKEND' });
  const completion = await readCompletedStage({ buildRoot: retainedRoot, mode: 'code' });
  assert.equal(completion.snapshot.graphCapability.status, 'ready');
  const graph = await buildIndex(root, { recovery: { action: 'open-graph', indexRoot: retainedRoot } });
  assert.equal(graph.buildId, retainedId);
  assert.equal(graph.status, 'ready');
  assert.equal(graph.outcome, undefined);
  assert.notEqual(graph.indexRoot, retainedRoot, 'graph reads own an immutable copy');
  const frozenMeta = await fs.readFile(path.join(graph.indexDir, 'chunk_meta.json'), 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null; // chunk metadata may use the canonical sharded representation.
  });
  await fs.writeFile(path.join(retainedRoot, 'index-code/pieces/manifest.json'), '{}');
  const map = await withBuildGraphCapability(root, { indexRoot: retainedRoot, capabilityId: graph.capabilityId },
    capability => buildCodeMap({ repoRoot: root, indexDir: capability.indexDir, options: { strict: true } }));
  assert.ok(map, 'the actual map consumer reads the selected immutable index');
  if (frozenMeta !== null) assert.equal(await fs.readFile(path.join(graph.indexDir, 'chunk_meta.json'), 'utf8'), frozenMeta);
  assert.equal(await fs.readFile(pointerPath, 'utf8'), oldPointer);
  assert.equal(JSON.parse(oldPointer).buildId, healthy.buildId);

  let childSettled = false, retainedError, originalFailure;
  await assert.rejects(withBuildGraphCapability(root, { indexRoot: retainedRoot }, async () => {
    originalFailure = Object.assign(new Error('consumer original descriptor close pending'), {
      cacheOwnershipPending: true, cacheOwnershipReleased: () => childSettled
    });
    throw originalFailure;
  }), error => { retainedError = error; return typeof error.releaseGraphReader === 'function'; });
  assert.ok(inspectRepoCacheAccess(getRepoCacheRoot(root)).some(owner => owner.reason === 'resource-settlement-unconfirmed'));
  originalFailure.cacheOwnershipPending = false;
  originalFailure.cacheOwnershipReleased = () => true;
  assert.throws(() => retainedError.releaseGraphReader(), 'unsettled original child retains the reader lease');
  childSettled = true;
  assert.equal(retainedError.releaseGraphReader(), true);
  assert.equal(retainedError.releaseGraphReader(), true);
  const state = JSON.parse(await fs.readFile(path.join(retainedRoot, 'build_state.json')));
  assert.equal(state.runtime.attempts.find(attempt => attempt.attemptId === completion.originatingAttemptId).lifecycle, 'failed');
  await assert.rejects(withBuildGraphCapability(root, { indexRoot: retainedRoot, capabilityId: 'wrong-revision' }, () => {}),
    { code: 'ERR_GRAPH_CAPABILITY_UNAVAILABLE' });
  await fs.writeFile(path.join(graph.indexRoot, 'stage-completion.json'), '{}');
  await assert.rejects(withBuildGraphCapability(root, { indexRoot: retainedRoot }, () => {}), { code: 'ERR_COMPLETED_STAGE_INVALID' });
} finally { await fs.rm(directory, { recursive: true, force: true }); }
console.log('immutable graph capability isolates failed optional work and pins consumer ownership');
