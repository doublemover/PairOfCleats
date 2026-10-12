#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveEmbeddingRuntime as outer } from '../../../src/integrations/core/embeddings.js';
import { resolveEmbeddingRuntime as inner } from '../../../src/index/build/runtime/embeddings.js';
import { runEmbeddingsStage } from '../../../src/integrations/core/build-index/stages.js';
import { parseBuildEmbeddingsArgs } from '../../../tools/build/embeddings/cli.js';
import { runBuildEmbeddingsWithConfig } from '../../../tools/build/embeddings/runner.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-embedding-intent-'));
applyTestEnv({ cacheRoot: path.join(temp, 'cache') });
try {
  for (const scenario of [
    { env: 'off', config: { mode: 'service' }, cli: true, enabled: false, mode: 'off' },
    { env: 'stub', config: { mode: 'auto' }, enabled: true, mode: 'stub' },
    { env: '', config: { enabled: false }, cli: true, enabled: false, mode: 'off' },
    { env: 'stub', config: { mode: 'off' }, enabled: false, mode: 'off' },
    { env: '', config: { mode: 'auto' }, cli: true, enabled: true, mode: 'stub' },
    { env: '', config: { mode: 'service' }, enabled: true, mode: 'service' }
  ]) {
    const models = path.join(temp, 'models');
    const userConfig = { models: { dir: models }, indexing: { embeddings: scenario.config } };
    const argv = { 'stub-embeddings': scenario.cli === true };
    await withTemporaryEnv({ PAIROFCLEATS_EMBEDDINGS: scenario.env,
      PAIROFCLEATS_TEST_CONFIG: JSON.stringify(userConfig) }, async () => {
      const selected = outer({ argv, userConfig, policy: { indexing: { embeddings: { enabled: true } } } });
      const runtime = await inner({ rootDir: temp, userConfig, indexingConfig: userConfig.indexing,
        envConfig: { embeddings: scenario.env }, argv, cpuConcurrency: 1 });
      const parsed = parseBuildEmbeddingsArgs(['--repo', temp, ...(scenario.cli ? ['--stub-embeddings'] : [])]);
      assert.equal(selected.embeddingEnabled, scenario.enabled);
      assert.equal(selected.resolvedEmbeddingMode, scenario.mode);
      assert.equal(runtime.embeddingEnabled || runtime.embeddingService, scenario.enabled);
      assert.equal(parsed.embeddingIntent.embeddingEnabled, scenario.enabled);
      assert.equal(parsed.resolvedEmbeddingMode, scenario.mode === 'service' ? 'inline' : scenario.mode);
      if (!scenario.enabled) {
        assert.deepEqual(await runtime.getChunkEmbeddings(['never infer']), []);
        assert.equal((await runBuildEmbeddingsWithConfig(parsed)).skipped, true);
        const result = await runEmbeddingsStage({ root: temp, argv, embedModes: ['code'],
          embeddingRuntime: selected, userConfig, log: () => {}, recordIndexMetric: () => {},
          buildEmbeddingsPath: path.join(temp, 'must-not-launch.mjs') });
        assert.equal(result.embeddings.skipped, true);
        await assert.rejects(fs.stat(path.join(temp, 'cache', 'service', 'queue')), { code: 'ENOENT' });
      }
    });
  }
  console.log('embedding intent boundary parity test passed');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
