#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseBuildArgs } from '../../../src/index/build/args.js';
import { createBuildRuntime } from '../../../src/index/build/runtime.js';
import { resolveFileCapsAndGuardrails } from '../../../src/index/build/runtime/caps.js';
import { resolveSchedulerConfig } from '../../../src/index/build/runtime/scheduler.js';
import { resolveScmConfig } from '../../../src/index/scm/registry.js';
import { teardownRuntime } from '../../../src/integrations/core/build-index/runtime.js';
import { resolveRuntimeEnvelope } from '../../../src/shared/runtime-envelope/resolve.js';
import { loadUserConfig } from '../../../tools/dict-utils/config.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-loader-indexing-'));
const root = path.join(tempRoot, 'repo');
await fs.mkdir(root);
const configPath = path.join(root, '.pairofcleats.json');
applyTestEnv({ cacheRoot: path.join(tempRoot, 'cache'), embeddings: 'off', testConfig: null });
const config = {
  indexing: {
    concurrency: 1,
    importConcurrency: 2,
    ioConcurrencyCap: 3,
    typeInference: false,
    typeInferenceCrossFile: false,
    riskAnalysis: false,
    riskAnalysisCrossFile: false,
    maxFileBytes: 12345,
    fileCaps: { default: { maxLines: 321 }, byExt: { '.js': { maxBytes: 2345 } } },
    scheduler: { enabled: false, cpuTokens: 2, queues: { 'stage1.cpu': { priority: 0, maxPending: 0 } } },
    scm: { provider: 'none', annotate: { enabled: false }, churnWindowCommits: 17 },
    workerPool: { enabled: false },
    treeSitter: { enabled: false },
    embeddings: { enabled: false, hnsw: { enabled: false }, lancedb: { enabled: false } }
  },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
};
const envelope = (userConfig, argv = {}, rawArgv = []) => resolveRuntimeEnvelope({
  argv,
  rawArgv,
  userConfig,
  env: {},
  execArgv: [],
  cpuCount: 8,
  autoPolicy: { indexing: { concurrency: { files: 7, imports: 6, io: 5 } } }
});

try {
  await fs.writeFile(configPath, JSON.stringify(config));
  const loaded = loadUserConfig(root);
  const resolved = envelope(loaded);
  assert.equal(resolved.concurrency.threads.value, 1);
  assert.equal(resolved.concurrency.threads.source, 'config');
  assert.equal(resolved.concurrency.importConcurrency.value, 2);
  assert.equal(resolved.concurrency.ioConcurrency.value, 3);
  const cli = envelope(loaded, { threads: 4 }, ['--threads', '4']);
  assert.equal(cli.concurrency.threads.value, 4);
  assert.equal(cli.concurrency.threads.source, 'cli');
  assert.equal(envelope({}).concurrency.threads.value, 7, 'absent concurrency retains auto-policy fallback');

  const caps = resolveFileCapsAndGuardrails(loaded.indexing);
  assert.equal(caps.maxFileBytes, 12345);
  assert.equal(caps.fileCaps.default.maxLines, 321);
  assert.equal(caps.fileCaps.byExt['.js'].maxBytes, 2345);
  const scm = resolveScmConfig({ indexingConfig: loaded.indexing });
  assert.equal(scm.provider, 'none');
  assert.equal(scm.annotate.enabled, false);
  assert.equal(scm.churnWindowCommits, 17);
  const scheduler = resolveSchedulerConfig({
    argv: {}, rawArgv: [], envConfig: {}, indexingConfig: loaded.indexing, envelope: resolved
  });
  assert.equal(scheduler.enabled, false);
  assert.equal(scheduler.cpuTokens, 2);
  assert.equal(scheduler.queues['stage1.cpu'].priority, 0);
  assert.equal(scheduler.queues['stage1.cpu'].maxPending, 0);

  // Use the actual build consumer rather than reimplementing its boolean gate.
  // Disable costly services in the on-disk config, not via post-loader test overrides.
  for (const enabled of [false, true]) {
    if (enabled) delete config.indexing.typeInference;
    await fs.writeFile(configPath, JSON.stringify(config));
    const runtime = await createBuildRuntime({
      root,
      argv: parseBuildArgs([]).argv,
      rawArgv: [],
      policy: {}
    });
    try {
      assert.equal(runtime.typeInferenceEnabled, enabled);
      assert.equal(runtime.analysisPolicy.typeInference.local.enabled, enabled);
      assert.equal(runtime.typeInferenceCrossFileEnabled, false);
      assert.equal(runtime.riskAnalysisEnabled, false);
      assert.equal(runtime.cpuConcurrency, 1);
      assert.equal(runtime.schedulerConfig.enabled, false);
      assert.equal(runtime.scmProvider, 'none');
    } finally {
      await teardownRuntime(runtime);
    }
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('config loader indexing runtime test passed');
