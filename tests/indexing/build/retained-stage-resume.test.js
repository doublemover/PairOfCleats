#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/build-index/index.js';
import { readCompletedStage } from '../../../src/index/build/completed-stage.js';
import { createSemanticEnrichmentGrant } from '../../../src/index/semantic/enrichment-context.js';
import { getRepoCacheRoot } from '../../../src/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-retained-resume-'));
try {
  const root = path.join(directory, 'repo');
  await fs.mkdir(root);
  const sourcePath = path.join(root, 'tiny.js'), source = 'export const value = 1;\n';
  await fs.writeFile(sourcePath, source);
  await fs.writeFile(path.join(root, 'notes.md'), '# Notes\nA tiny prose file.\n');
  applyTestEnv({ cacheRoot: path.join(directory, 'cache'), embeddings: 'off',
    extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null },
    testConfig: createFastIndexingTestConfig({ threads: 1, sqlite: { use: false },
      indexing: { workerPool: { enabled: false }, semantic: { enabled: false }, embeddings: { enabled: false, mode: 'off' } } }) });
  let buildRoot, buildId;
  const grant = createSemanticEnrichmentGrant({ attach: async runtime => {
    buildRoot = runtime.buildRoot; buildId = runtime.buildId;
    return { beforePublish: async () => { throw Object.assign(new Error('injected final validation/publication boundary'), { code: 'ERR_FIXTURE_RETAINED' }); } };
  } });
  await assert.rejects(buildIndex(root, { modes: ['code', 'prose'], stage: 'stage2', progress: 'off', semanticEnrichmentDrain: grant }),
    { code: 'ERR_FIXTURE_RETAINED' });
  const originalCode = await readCompletedStage({ buildRoot, mode: 'code' });
  assert.ok(originalCode.producer.identity);
  const statePath = path.join(buildRoot, 'build_state.json');
  const state = JSON.parse(await fs.readFile(statePath));
  delete state.completedStages.prose;
  await fs.writeFile(statePath, JSON.stringify(state));
  await fs.rm(path.join(buildRoot, 'index-prose'), { recursive: true });
  await fs.unlink(path.join(buildRoot, 'artifact-publication.prose.json'));
  const inspect = () => buildIndex(root, { recovery: { action: 'inspect', operation: 'resume',
    indexRoot: buildRoot, modes: ['code', 'prose'], resumeTarget: 'stage2' } });
  let plan = await inspect();
  assert.equal(plan.blocked, null);
  assert.deepEqual(plan.reusedModes, ['code']);
  assert.deepEqual(plan.rebuiltModes, ['prose']);
  assert.equal(plan.work.parseFiles, null, 'missing mode work is unknown until normal execution');
  const pointer = path.join(getRepoCacheRoot(root), 'builds/current.json');
  await fs.writeFile(sourcePath, source.replace('1', '2'));
  await assert.rejects(buildIndex(root, { recovery: { action: 'execute', plan } }),
    { code: 'ERR_RECOVERY_INPUT_CHANGED' }, 'historical resume cannot silently refresh a changed source snapshot');
  await assert.rejects(fs.stat(pointer), { code: 'ENOENT' });
  assert.equal((await readCompletedStage({ buildRoot, mode: 'code' })).snapshot.relativeRoot, originalCode.snapshot.relativeRoot);
  await fs.writeFile(sourcePath, source);
  plan = await inspect();
  const resumed = await buildIndex(root, { recovery: { action: 'execute', plan }, progress: 'off' });
  assert.equal(resumed.buildId, buildId);
  assert.equal(resumed.work.modes.code.status, 'reused');
  assert.equal(resumed.work.modes.code.parsedFiles, 0);
  assert.equal(resumed.work.modes.prose.status, 'sealed');
  assert.equal(resumed.publication.status, 'published');
  assert.equal(JSON.parse(await fs.readFile(pointer)).buildId, buildId);
  assert.equal((await readCompletedStage({ buildRoot, mode: 'code' })).snapshot.relativeRoot, originalCode.snapshot.relativeRoot);
  assert.notEqual((await readCompletedStage({ buildRoot, mode: 'prose' })).originatingAttemptId, originalCode.originatingAttemptId);
  const pointerBytes = await fs.readFile(pointer, 'utf8');
  const repeated = await buildIndex(root, { recovery: { action: 'execute', plan } });
  assert.equal(repeated.alreadyComplete, true);
  assert.equal(repeated.runtimeAttemptId, resumed.runtimeAttemptId);
  assert.equal(await fs.readFile(pointer, 'utf8'), pointerBytes);
  const final = JSON.parse(await fs.readFile(statePath));
  assert.equal(final.runtime.attempts.find(attempt => attempt.attemptId === originalCode.originatingAttemptId).lifecycle, 'failed');
  await assert.rejects(buildIndex(root, { recovery: { action: 'execute', plan: { ...plan, resumeTarget: 'full' } } }),
    { code: 'ERR_RECOVERY_PLAN_STALE' });
} finally { await fs.rm(directory, { recursive: true, force: true }); }
console.log('reviewed resume restores exact complete modes and executes missing modes through the build owner');
