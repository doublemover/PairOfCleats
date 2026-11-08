#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/build-index/index.js';
import { createSemanticEnrichmentGrant } from '../../../src/index/semantic/enrichment-context.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-stage-import-authority-'));
try {
  const root = path.join(directory, 'repo');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'value.js'), 'export const value = 1;\n');
  await fs.writeFile(path.join(root, 'consumer.js'), "import { value } from './value.js';\nexport function read() { return value; }\n");
  applyTestEnv({ cacheRoot: path.join(directory, 'cache'), embeddings: 'off',
    extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null },
    testConfig: createFastIndexingTestConfig({ threads: 1, sqlite: { use: false },
      indexing: { workerPool: { enabled: false }, semantic: { enabled: false }, embeddings: { enabled: false, mode: 'off' } } }) });
  let retainedId;
  const grant = createSemanticEnrichmentGrant({ attach: async runtime => {
    retainedId = runtime.buildId;
    return { beforePublish: async () => { throw Object.assign(new Error('injected failure after import output publication'), { code: 'ERR_FIXTURE_IMPORT_RETAINED' }); } };
  } });
  await assert.rejects(buildIndex(root, { mode: 'code', stage: 'stage2', progress: 'off', semanticEnrichmentDrain: grant }),
    { code: 'ERR_FIXTURE_IMPORT_RETAINED' });
  const result = await buildIndex(root, { mode: 'code', stage: 'stage2', progress: 'off' });
  assert.notEqual(result.buildId, retainedId, 'compiler/source equality cannot substitute for missing import-resolver closure authority');
  assert.equal(result.completedStageWork.code.status, 'sealed');
  const state = JSON.parse(await fs.readFile(path.join(result.buildRoot, 'build_state.json')));
  assert.equal(state.runtime.attempts.at(-1).inputs.executionPlan.reuseDecision.reason,
    'import-resolution-dependency-inventory-unavailable');
} finally { await fs.rm(directory, { recursive: true, force: true }); }
console.log('ordinary Stage2 recomputes when the separate import-resolution dependency inventory is unavailable');
