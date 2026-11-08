#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/build-index/index.js';
import { getRepoCacheRoot } from '../../../src/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-reviewed-fresh-'));
try {
  const root = path.join(directory, 'repo');
  await fs.mkdir(root);
  const source = path.join(root, 'tiny.js');
  await fs.writeFile(source, 'export const value = 1;\n');
  applyTestEnv({ cacheRoot: path.join(directory, 'cache'), embeddings: 'off',
    extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null },
    testConfig: createFastIndexingTestConfig({ threads: 1, sqlite: { use: false },
      indexing: { workerPool: { enabled: false }, semantic: { enabled: false }, embeddings: { enabled: false, mode: 'off' } } }) });
  const original = await buildIndex(root, { mode: 'code', stage: 'stage2', progress: 'off' });
  const originalManifest = await fs.readFile(path.join(original.buildRoot, 'index-code/pieces/manifest.json'), 'utf8');
  await fs.writeFile(source, 'export const value = 2;\n');
  const plan = await buildIndex(root, { recovery: { action: 'inspect', operation: 'refresh',
    indexRoot: original.buildRoot, resumeTarget: 'stage2', modes: ['code'] } });
  assert.equal(plan.blocked, null, 'a fresh generation can be planned beside a healthy current source generation');
  assert.equal(plan.destination.kind, 'new-generation');
  assert.equal(plan.destination.buildRoot, null, 'the existing runtime owns allocation at execution');
  assert.equal(plan.sourceScope, 'current-working-tree-refresh');
  assert.deepEqual(plan.reusedModes, []);
  const refreshed = await buildIndex(root, { recovery: { action: 'execute', plan }, progress: 'off' });
  assert.notEqual(refreshed.buildId, original.buildId);
  assert.notEqual(refreshed.buildRoot, original.buildRoot);
  assert.equal(refreshed.sourceBuildId, original.buildId);
  assert.equal(refreshed.work.modes.code.status, 'sealed');
  assert.equal(refreshed.work.parsedFiles, null, 'unrecorded recomputed-file counts remain unknown');
  assert.equal(refreshed.publication.status, 'published');
  assert.equal(await fs.readFile(path.join(original.buildRoot, 'index-code/pieces/manifest.json'), 'utf8'), originalManifest);
  const pointer = path.join(getRepoCacheRoot(root), 'builds/current.json');
  assert.equal(JSON.parse(await fs.readFile(pointer)).buildId, refreshed.buildId);
  const repeated = await buildIndex(root, { recovery: { action: 'execute', plan } });
  assert.equal(repeated.alreadyComplete, true);
  assert.equal(repeated.buildId, refreshed.buildId);
  const clean = await buildIndex(root, { recovery: { action: 'inspect', operation: 'clean',
    indexRoot: refreshed.buildRoot, resumeTarget: 'stage2', modes: ['code'] } });
  assert.deepEqual(clean.reusedModes, []);
  assert.equal(clean.work.rebuildArtifacts, true);
  assert.equal(clean.blocked, null);
  const cleaned = await buildIndex(root, { recovery: { action: 'execute', plan: clean }, progress: 'off' });
  assert.notEqual(cleaned.buildId, refreshed.buildId);
  assert.deepEqual(cleaned.work.reusedModes, []);
  assert.equal(cleaned.work.modes.code.status, 'sealed');
  const cleanPointer = await fs.readFile(pointer, 'utf8');
  const historical = await buildIndex(root, { recovery: { action: 'execute', plan } });
  assert.equal(historical.alreadyComplete, true);
  assert.equal(historical.publication.currentPointerUnchangedSinceCompletion, false);
  assert.equal(await fs.readFile(pointer, 'utf8'), cleanPointer);
} finally { await fs.rm(directory, { recursive: true, force: true }); }
console.log('reviewed refresh builds current sources in a distinct generation and preserves historical artifacts');
