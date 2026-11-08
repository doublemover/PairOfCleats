#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadUserConfig } from '../../../tools/dict-utils/config.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createEmbeddingExecutionPlan, validateEmbeddingExecutionPlan, applyEmbeddingExecutionPlan } from '../../../src/shared/embedding-execution-plan.js';
import { stableStringify } from '../../../src/shared/stable-json.js';

const root = process.cwd();
const base = { root, indexRoot: root, modes: ['code'], rawEnv: {} };
const defaults = createEmbeddingExecutionPlan(base);
assert.equal(defaults.embeddings.model, 'Xenova/all-MiniLM-L12-v2');
assert.equal(defaults.sources.model, 'default');
const configured = createEmbeddingExecutionPlan({ ...base,
  userConfig: { models: { id: 'models-choice' }, indexing: { embeddings: { model: 'indexing-choice' } } } });
assert.equal(configured.embeddings.model, 'indexing-choice');
assert.equal(configured.sources.model, 'config.indexing.embeddings.model');
const resolved = createEmbeddingExecutionPlan({ ...base, modelId: 'models-choice',
  userConfig: { models: { id: 'models-choice' } } });
assert.equal(resolved.sources.model, 'config.models.id', 'resolved runtime value is not fabricated CLI intent');
const sampling = createEmbeddingExecutionPlan({ ...base,
  rawEnv: { PAIROFCLEATS_EMBEDDINGS_SAMPLE_SEED: 'stable-request-seed', PAIROFCLEATS_SCHEDULER_CPU: '3' },
  userConfig: { indexing: { embeddings: { sampleSeed: 'config-seed' }, scheduler: { adaptiveSurfaces: {} } } } });
assert.equal(sampling.environment.PAIROFCLEATS_EMBEDDINGS_SAMPLE_SEED, 'stable-request-seed');
assert.equal(sampling.embeddings.sampleSeed, 'config-seed');
assert.equal(sampling.environment.PAIROFCLEATS_SCHEDULER_CPU, '3');
assert.equal(validateEmbeddingExecutionPlan(JSON.parse(JSON.stringify(sampling))).digest, sampling.digest);

const secret = 'UNRELATED_SECRET_SENTINEL';
const plan = createEmbeddingExecutionPlan({ ...base,
  argv: { model: 'approved-model', dims: 32, password: secret },
  rawEnv: { PAIROFCLEATS_API_TOKEN: secret, PAIROFCLEATS_THREADS: secret, ARBITRARY_ENV: secret },
  userConfig: {
    credentials: { password: secret }, runtime: { nodeOptions: `--require=${secret}`, scheduler: { secret, cpuTokens: 2 } },
    models: { dir: '/owned/models' },
    indexing: { embeddings: { provider: 'onnx', secret, onnx: { modelPath: '/owned/model.onnx',
      tokenizerId: 'approved-tokenizer', authorization: secret, prewarmTexts: [secret] } } }
  }
});
const serialized = JSON.stringify(plan);
assert.equal(serialized.includes(secret), false);
assert.equal(plan.environment.PAIROFCLEATS_THREADS, null);
assert.equal(plan.embeddings.onnx.modelPath, '/owned/model.onnx');
assert.equal(plan.embeddings.onnx.tokenizerId, 'approved-tokenizer');
assert.equal(plan.modelsDir, '/owned/models');
assert.equal(plan.resources.scheduler.cpuTokens, 2);
assert.equal(plan.sources.model, 'cli.model');
assert.equal(validateEmbeddingExecutionPlan(JSON.parse(serialized)).digest, plan.digest);
assert.throws(() => createEmbeddingExecutionPlan({ ...base, argv: { model: 'https://user:password@example.com/model' } }), /credential-bearing/);
const resign = plan => {
  const { selectedAt: ignoredTime, digest: ignoredDigest, ...semantic } = plan;
  plan.digest = crypto.createHash('sha256').update(stableStringify(semantic)).digest('hex');
  return plan;
};
for (const mutate of [
  candidate => { candidate.embeddings.arbitraryExecutableConfig = true; },
  candidate => { candidate.resources.indexing.command = 'unexpected'; },
  candidate => { candidate.embeddings.onnx.authorization = 'unexpected'; },
  candidate => { candidate.embeddings.quantization.extra = 1; },
  candidate => { candidate.embeddings.embeddinggemma2.extra = 1; },
  candidate => { candidate.resources.scheduler.queues = { test: { priority: 1, executable: true } }; },
  candidate => { candidate.resources.scheduler.autoTune = { enabled: true, command: 'unexpected' }; },
  candidate => { candidate.sources.rawConfig = { secret }; },
  candidate => { candidate.sources.config = { version: 1, files: [], repoTrusted: false,
    discardedAuthorityPaths: [], trustedMerge: false, testOverlay: { applied: false, source: 'test-environment' }, rawConfig: {} }; },
  candidate => { candidate.resources = []; },
  candidate => { candidate.embeddings = []; },
  candidate => { candidate.environment.PAIROFCLEATS_THREADS = secret; },
  candidate => { candidate.options.threads = { value: 1 }; }
]) {
  const candidate = JSON.parse(serialized);
  mutate(candidate);
  resign(candidate);
  assert.throws(() => validateEmbeddingExecutionPlan(candidate), { code: 'ERR_EMBEDDING_EXECUTION_PLAN' });
  assert.throws(() => applyEmbeddingExecutionPlan(candidate, {}, {}), { code: 'ERR_EMBEDDING_EXECUTION_PLAN' });
}
for (const malformed of [null, [], 'plan', 1, true, {}, { version: 1, digest: 'invalid' }]) {
  assert.throws(() => validateEmbeddingExecutionPlan(malformed), { code: 'ERR_EMBEDDING_EXECUTION_PLAN' });
}
const circular = { version: 1, digest: 'invalid' };
circular.sources = circular;
assert.throws(() => validateEmbeddingExecutionPlan(circular), { code: 'ERR_EMBEDDING_EXECUTION_PLAN' });
console.log('embedding execution plan allowlist and model precedence test passed');

// Use the actual source owner: an absent optional config has settled diagnostics
// that must not change the strict child-plan wire shape.
const { dir } = await prepareIsolatedTestCacheDir('embedding-plan-config-origin');
const configPath = path.join(dir, '.pairofcleats.json');
for (const present of [false, true]) {
  if (present) await fs.writeFile(configPath, '{"quality":"fast"}\n');
  let configSources;
  const userConfig = loadUserConfig(dir, { env: {}, onSources: value => { configSources = value; } });
  assert.equal(configSources.files[0].exists, present);
  if (!present) assert.equal(configSources.files[0].readState, 'missing');
  const intent = { embeddingEnabled: true, useStubEmbeddings: true, resolvedEmbeddingMode: 'stub',
    reason: 'cli-stub', configSources };
  const origin = createEmbeddingExecutionPlan({ ...base, root: dir, indexRoot: dir, userConfig, intent });
  const expected = structuredClone(configSources);
  if (!present) delete expected.files[0].readState;
  assert.deepEqual(origin.sources.config, expected);
  assert.equal(validateEmbeddingExecutionPlan(JSON.parse(JSON.stringify(origin))).digest, origin.digest);
  for (const mutate of [
    file => { file.readState = 'pending'; },
    file => { file.readState = 'failed'; },
    file => { file.command = 'unexpected'; },
    file => { file.readState = 'missing'; file.errorCode = 'EACCES'; }
  ]) {
    const invalid = structuredClone(configSources);
    mutate(invalid.files[0]);
    assert.throws(() => createEmbeddingExecutionPlan({ ...base, userConfig,
      intent: { ...intent, configSources: invalid } }), { code: 'ERR_EMBEDDING_EXECUTION_PLAN' });
  }
}
