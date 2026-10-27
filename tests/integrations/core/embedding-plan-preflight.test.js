import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('integrations/core/embedding-plan-preflight/')[1];
assert.ok(['missing-selected', 'missing-default', 'present', 'pinned-graph', 'inactive', 'deferred', 'provider', 'cancel', 'evidence'].includes(mode));
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  assert.ok(!/^(?:onnxruntime-node|@huggingface\/transformers|@xenova\/transformers)(?:\/|$)/u.test(specifier),
    `Read-only preflight loaded an inference provider: ${specifier}`);
  return nextResolve(specifier, context);
} });
try {
  const { createEmbeddingExecutionPlan, preflightEmbeddingExecutionPlan, bindEmbeddingExecutionPlan,
    validateEmbeddingExecutionPlan, projectEmbeddingExecutionEvidence } = await import('../../../src/shared/embedding-execution-plan.js');
  const { dir } = await prepareIsolatedTestCacheDir(`embedding-preflight-${mode}`);
  const modelsDir = path.join(dir, 'models');
  const modelRoot = path.join(modelsDir, 'fixture', 'model');
  const graph = path.join(modelRoot, 'onnx', 'model.onnx');
  const otherGraph = path.join(modelRoot, 'onnx', 'model_quantized.onnx');
  const env = applyTestEnv({ syncProcess: false, extraEnv: { PAIROFCLEATS_EMBEDDINGS: null } });
  const make = ({ provider = 'onnx', modelPath = '', enabled = true, stub = false, service = false } = {}) =>
    createEmbeddingExecutionPlan({ root: dir, modes: ['code', 'prose'], argv: { model: 'fixture/model', dims: 8 },
      userConfig: { models: { id: 'fixture/model', dir: modelsDir }, indexing: { embeddings: { provider, onnx: { modelPath } } } },
      rawEnv: env, intent: { embeddingEnabled: enabled, useStubEmbeddings: stub,
        resolvedEmbeddingMode: !enabled ? 'off' : stub ? 'stub' : service ? 'service' : 'inline' } });
  if (mode === 'missing-selected') {
    const selected = path.join(dir, 'missing.onnx');
    assert.throws(() => preflightEmbeddingExecutionPlan(make({ modelPath: selected })), error =>
      error.code === 'ERR_EMBEDDING_MODEL_PATH' && error.modelPath === selected && Boolean(error.cause));
  } else if (mode === 'missing-default') {
    assert.throws(() => preflightEmbeddingExecutionPlan(make()), error => error.code === 'ERR_EMBEDDING_PREFLIGHT'
      && error.preflight.status === 'unavailable' && error.preflight.downloadAttempted === false);
  } else if (mode === 'present' || mode === 'pinned-graph') {
    await fs.mkdir(path.dirname(graph), { recursive: true });
    // Deliberately invalid model bytes prove this is a presence check, not a
    // native model load or successful inference qualification.
    await fs.writeFile(graph, 'presence-only fixture, not an ONNX model');
    await fs.writeFile(otherGraph, 'alternate must not rescue a pinned graph');
    const requested = make();
    const admitted = preflightEmbeddingExecutionPlan(requested);
    assert.equal(requested.embeddings.onnx.modelPath, '');
    assert.equal(admitted.plan.embeddings.onnx.modelPath, graph);
    assert.equal(admitted.plan.selectedAt, requested.selectedAt);
    assert.equal(admitted.preflight.status, 'ready-to-attempt');
    assert.equal(admitted.preflight.runtime, 'unverified');
    assert.equal(admitted.preflight.inference, 'unverified');
    assert.equal(admitted.preflight.downloadAttempted, false);
    assert.ok(Object.isFrozen(admitted.plan.embeddings.onnx));
    assert.ok(Object.isFrozen(admitted.preflight));
    assert.notEqual(admitted.plan.digest, requested.digest);
    assert.equal(validateEmbeddingExecutionPlan(admitted.plan), admitted.plan);
    for (const key of ['options', 'modelsDir', 'resources', 'environment', 'sources']) assert.deepEqual(admitted.plan[key], requested[key], key);
    const bound = bindEmbeddingExecutionPlan(admitted.plan, { root: dir, indexRoot: path.join(dir, 'generated'), buildId: 'fixture', modes: ['code'] });
    assert.equal(bound.embeddings.onnx.modelPath, graph);
    if (mode === 'pinned-graph') {
      await fs.unlink(graph);
      assert.throws(() => preflightEmbeddingExecutionPlan(bound), error =>
        error.code === 'ERR_EMBEDDING_MODEL_PATH' && error.modelPath === graph);
      assert.equal((await fs.stat(otherGraph)).isFile(), true);
    }
  } else if (mode === 'inactive') {
    for (const options of [{ enabled: false }, { stub: true }]) {
      const result = preflightEmbeddingExecutionPlan(make({ ...options, modelPath: path.join(dir, 'absent.onnx') }));
      assert.equal(result.preflight.status, 'inactive');
      assert.equal(result.plan.embeddings.onnx.modelPath, path.join(dir, 'absent.onnx'));
    }
  } else if (mode === 'deferred') {
    for (const [options, host] of [[{}, 'deferred'], [{ service: true }, 'local']]) {
      const plan = make({ ...options, modelPath: path.join(dir, 'remote-only.onnx') });
      const result = preflightEmbeddingExecutionPlan(plan, { executionHost: host });
      assert.equal(result.preflight.status, 'unverified');
      assert.equal(result.preflight.reason, 'execution-host-deferred');
      assert.equal(result.plan.digest, plan.digest);
    }
    assert.throws(() => preflightEmbeddingExecutionPlan(make(), { executionHost: 'unknown' }), /invalid preflight execution host/);
  } else if (mode === 'provider') {
    const plan = make({ provider: 'xenova', modelPath: path.join(dir, 'absent.onnx') });
    const result = preflightEmbeddingExecutionPlan(plan);
    assert.equal(result.preflight.status, 'unverified');
    assert.equal(result.preflight.reason, 'provider-acquisition-at-execution');
    assert.equal(result.preflight.downloadAttempted, false);
    assert.equal(result.plan.digest, plan.digest);
  } else if (mode === 'evidence') {
    const admitted = preflightEmbeddingExecutionPlan(make({ provider: 'xenova' }));
    const evidence = projectEmbeddingExecutionEvidence(admitted, { root: dir });
    assert.equal(evidence.planDigest, admitted.plan.digest);
    assert.equal(evidence.selectedAt, admitted.plan.selectedAt);
    assert.equal(evidence.requested.modelId, 'fixture/model');
    assert.equal(evidence.preflight.status, 'unverified');
    assert.ok(Object.isFrozen(evidence.preflight));
    assert.equal(evidence.environment, undefined);
    for (const key of ['environmentSelectionDigest', 'resourceRequestDigest', 'profileDigest']) assert.match(evidence[key], /^[a-f0-9]{64}$/u);
    assert.throws(() => projectEmbeddingExecutionEvidence({ ...admitted, preflight: { ...admitted.preflight } }),
      /preflight evidence does not belong/);
    assert.throws(() => projectEmbeddingExecutionEvidence({ ...admitted, plan: make({ provider: 'xenova', modelPath: 'different.onnx' }) }),
      /preflight evidence does not belong/);
    assert.throws(() => projectEmbeddingExecutionEvidence(admitted, { root: modelsDir }), /repository root mismatch/);
  } else {
    const controller = new AbortController();
    controller.abort('fixture cancellation');
    assert.throws(() => preflightEmbeddingExecutionPlan(make(), { signal: controller.signal }),
      error => error.code === 'ABORT_ERR' && error.cause === 'fixture cancellation');
  }
} finally { hooks.deregister(); }
console.log(`Read-only embedding graph preflight: ${mode}`);
