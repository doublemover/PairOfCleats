#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBuildRuntime } from '../../../src/index/build/runtime/runtime.js';
import { buildAutoPolicy } from '../../../src/shared/auto-policy/build.js';
import { teardownRuntime } from '../../../src/integrations/core/build-index/runtime.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const temp = await fs.realpath(await makeTempDir('poc-worker-pool-policy-'));
const repo = path.join(temp, 'repo');
const config = {
  quality: 'fast', threads: 1,
  indexing: { scm: { provider: 'none' }, workerPool: { enabled: false, maxWorkers: 1 },
    embeddings: { enabled: false, mode: 'off' }, typeInference: false,
    typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
};
await fs.mkdir(repo);
await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify(config));
await fs.writeFile(path.join(repo, 'sample.js'), 'export const value = 1;\n');
applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'off' });
let runtime = null;
try {
  await withTemporaryEnv({
    PAIROFCLEATS_WORKER_POOL: null,
    PAIROFCLEATS_WORKER_POOL_MAX_WORKERS: null
  }, async () => {
    // A deterministic multicore policy reproduces the hosted override even on
    // a one-CPU test runner. The actual runtime must preserve the repo setting.
    const policy = await buildAutoPolicy({
      config, resources: { cpuCount: 4, memoryGb: 8 },
      repo: { fileCount: 1, totalBytes: 23, truncated: false, huge: false }
    });
    assert.equal(policy.runtime.workerPool.enabled, true, 'control: auto policy would enable workers');
    runtime = await createBuildRuntime({ root: repo,
      argv: { mode: 'code', stage: 'stage1', threads: 1 }, rawArgv: [], policy });
    assert.equal(runtime.userConfig.indexing.workerPool.enabled, false);
    assert.equal(runtime.workerPoolConfig.enabled, false, 'automatic policy must not replace explicit disabled workers');
    assert.equal(runtime.workerPoolConfig.maxWorkers, 1, 'explicit worker count survives policy defaults and resource bounds');
    assert.equal(runtime.workerPool, null, 'disabled configuration must not create a tokenize pool');
    assert.equal(runtime.quantizePool, null, 'disabled configuration must not create a quantize pool');

    await teardownRuntime(runtime);
    runtime = null;
    const unspecified = { ...config, indexing: { ...config.indexing } };
    delete unspecified.indexing.workerPool;
    await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify(unspecified));
    const disabledPolicy = { ...policy, runtime: { workerPool: { enabled: false, maxThreads: 2 } } };
    runtime = await createBuildRuntime({ root: repo,
      argv: { mode: 'code', stage: 'stage1', threads: 1 }, rawArgv: [], policy: disabledPolicy });
    assert.equal(runtime.workerPoolConfig.enabled, false, 'unspecified settings still use policy defaults');
    assert.equal(runtime.workerPoolConfig.maxWorkers, 2);
    assert.equal(runtime.workerPool, null);

    await teardownRuntime(runtime);
    runtime = null;
    await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({
      ...config, indexing: { ...config.indexing, workerPool: { enabled: true, maxWorkers: 128 } }
    }));
    await withTemporaryEnv({ PAIROFCLEATS_WORKER_POOL: 'off' }, async () => {
      runtime = await createBuildRuntime({ root: repo,
        argv: { mode: 'code', stage: 'stage1', threads: 1 }, rawArgv: [], policy: disabledPolicy });
      assert.equal(runtime.workerPoolConfig.enabled, false, 'environment override still wins over explicit config');
      assert.equal(runtime.workerPoolConfig.maxWorkers, 32, 'explicit counts still obey the existing hard cap');
      assert.equal(runtime.workerPool, null);
    });
  });
  console.log('Actual build runtime preserves explicit worker-pool settings over automatic policy.');
} finally {
  await teardownRuntime(runtime);
  await rmDirRecursive(temp);
}
