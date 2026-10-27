import assert from 'node:assert/strict';
import path from 'node:path';
import { createEmbeddingExecutionPlan, captureEmbeddingExecutionPlan, bindEmbeddingExecutionPlan,
  validateEmbeddingExecutionPlan } from '../../../src/shared/embedding-execution-plan.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { EMBEDDING_GEMMA2_REVISION } from '../../../src/shared/embedding-model-profile.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('integrations/core/embedding-plan-late-binding/')[1];
assert.ok(['selection', 'mode-scope', 'generation-scope', 'immutable', 'profile', 'inactive'].includes(mode));
const { dir } = await prepareIsolatedTestCacheDir(`embedding-plan-bind-${mode}`);
const env = applyTestEnv({ syncProcess: false, embeddings: 'stub', extraEnv: { PAIROFCLEATS_THREADS: '2' } });
const config = { threads: 2, models: { id: 'selected/model', dir: path.join(dir, 'models') },
  indexing: { embeddings: { provider: 'xenova', normalize: false }, scheduler: { enabled: true } } };
const plan = captureEmbeddingExecutionPlan(createEmbeddingExecutionPlan({ root: dir, modes: ['code', 'prose'],
  argv: { model: 'selected/model', dims: 16, threads: 2 }, userConfig: config, rawEnv: env,
  intent: { embeddingEnabled: true, useStubEmbeddings: true, resolvedEmbeddingMode: 'stub' } }));
const bound = bindEmbeddingExecutionPlan(plan, { root: dir, indexRoot: path.join(dir, 'build'), buildId: 'build-fixture', modes: ['code'] });
assert.equal(plan.indexRoot, null); assert.equal(plan.buildId, null); assert.deepEqual(plan.modes, ['code', 'prose']);
assert.equal(bound.indexRoot, path.resolve(dir, 'build')); assert.equal(bound.buildId, 'build-fixture');
assert.equal(bound.selectedAt, plan.selectedAt); assert.notEqual(bound.digest, plan.digest);
assert.equal(validateEmbeddingExecutionPlan(bound, { root: dir, indexRoot: path.join(dir, 'build'), modes: ['code'] }), bound);
if (mode === 'selection') {
  config.models.id = 'different/model'; config.indexing.embeddings.provider = 'onnx';
  config.indexing.embeddings.normalize = true; config.threads = 9; env.PAIROFCLEATS_THREADS = '9';
  const later = bindEmbeddingExecutionPlan(plan, { root: dir, indexRoot: path.join(dir, 'later'), modes: ['prose'] });
  for (const key of ['options', 'embeddings', 'modelsDir', 'resources', 'environment', 'sources']) assert.deepEqual(later[key], plan[key], key);
  assert.equal(later.embeddings.model, 'selected/model'); assert.equal(later.embeddings.provider, 'xenova');
  assert.equal(later.resources.threads, 2); assert.equal(later.environment.PAIROFCLEATS_THREADS, '2');
  assert.throws(() => bindEmbeddingExecutionPlan(plan, { model: 'injected/model' }), /unsupported binding fields/);
} else if (mode === 'mode-scope') {
  for (const modes of [[], ['records'], ['code', 'records']]) assert.throws(() => bindEmbeddingExecutionPlan(plan, { modes }), /cannot widen selected modes/);
  assert.throws(() => bindEmbeddingExecutionPlan(bound, { modes: ['prose'] }), /cannot widen selected modes/);
} else if (mode === 'generation-scope') {
  for (const indexRoot of ['', 'relative', 5]) assert.throws(() => bindEmbeddingExecutionPlan(plan, { indexRoot }), /binding indexRoot must be absolute/);
  assert.throws(() => bindEmbeddingExecutionPlan(bound, { indexRoot: path.join(dir, 'another') }), /cannot rebind selected index root/);
  assert.throws(() => bindEmbeddingExecutionPlan(bound, { buildId: 'another' }), /cannot rebind selected build identity/);
  assert.equal(bindEmbeddingExecutionPlan(bound, { indexRoot: bound.indexRoot, buildId: bound.buildId }).digest, bound.digest);
} else if (mode === 'immutable') {
  assert.ok(Object.isFrozen(plan)); assert.ok(Object.isFrozen(plan.embeddings.onnx)); assert.ok(Object.isFrozen(bound.environment));
  assert.throws(() => { plan.embeddings.model = 'changed'; }, TypeError);
  assert.throws(() => { bound.modes.push('records'); }, TypeError);
  assert.throws(() => bindEmbeddingExecutionPlan({ ...plan, modelsDir: path.join(dir, 'changed') }), /digest mismatch/);
} else {
  const createProfile = (options = {}, enabled = true, stub = false, dims = 768) => createEmbeddingExecutionPlan({ root: dir, modes: ['code'],
    argv: { model: 'onnx-community/embeddinggemma-2-ONNX', dims },
    userConfig: { ...config, indexing: { embeddings: { provider: 'xenova', normalize: true, embeddinggemma2: options } } },
    rawEnv: { ...env, PAIROFCLEATS_EMBEDDINGS: null }, intent: { embeddingEnabled: enabled, useStubEmbeddings: stub,
      resolvedEmbeddingMode: !enabled ? 'off' : stub ? 'stub' : 'inline' } });
  if (mode === 'profile') {
    const selected = createProfile();
    assert.deepEqual(selected.embeddings.embeddinggemma2, { revision: EMBEDDING_GEMMA2_REVISION, dtype: 'fp32', dimensions: 768 });
    for (const [options, expected] of [[{ dtype: 'fp64' }, /dtype must be/], [{ revision: 'main' }, /immutable 40-character/],
      [{ dimensions: 100 }, /dimensions must be/]]) assert.throws(() => createProfile(options), expected);
    assert.throws(() => createProfile({}, true, false, 16), /dimensions conflict/);
  } else {
    assert.equal(createProfile({ dtype: 'inactive-value' }, false).embeddings.enabled, false);
    assert.equal(createProfile({ dtype: 'unused-by-stub' }, true, true, 16).options['stub-embeddings'], true);
  }
}
console.log(`Pinned embedding selection late binding: ${mode}`);
