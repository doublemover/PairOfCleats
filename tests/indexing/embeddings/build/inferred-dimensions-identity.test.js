#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { __setAdapterFactoryForTests, __resetEmbeddingAdapterCachesForTests } from '../../../../src/shared/embedding-adapter.js';
import { buildEmbeddingIdentityKey } from '../../../../src/shared/embedding-identity.js';
import { parseBuildEmbeddingsArgs } from '../../../../tools/build/embeddings/args.js';
import { runBuildEmbeddingsWithConfig } from '../../../../tools/build/embeddings/runner.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { runNode } from '../../../helpers/run-node.js';
import { getRepoCacheRoot } from '../../../../src/shared/repo-paths.js';
import { createAbortError } from '../../../../src/shared/abort.js';
import { errorGraphIncludes, errorGraphMatches } from '../../../helpers/error-graph.js';

const { dir: tempRoot } = await prepareIsolatedTestCacheDir('embedding-inferred-dimensions', { clean: true });
const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(repoRoot, { recursive: true });
const source = 'export const alpha = 1;\n';
await fs.writeFile(path.join(repoRoot, 'alpha.js'), source);
const env = applyTestEnv({
  cacheRoot: path.join(tempRoot, 'cache'),
  embeddings: 'real',
  testConfig: {
    threads: 1,
    sqlite: { use: false },
    indexing: {
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false,
      scm: { provider: 'none' },
      embeddings: { enabled: true, mode: 'inline', provider: 'xenova', hnsw: { enabled: false }, lancedb: { enabled: false } }
    },
    tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
  }
});
runNode([
  path.resolve('build_index.js'), '--repo', repoRoot, '--stage', 'stage2',
  '--mode', 'code', '--threads', '1', '--progress', 'off'
], 'build canonical dimension fixture', process.cwd(), env, { stdio: 'pipe' });
const buildsDir = path.join(getRepoCacheRoot(repoRoot), 'builds');
const builds = (await fs.readdir(buildsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory());
assert.equal(builds.length, 1, 'fixture owns exactly one isolated build');
const indexRoot = path.join(buildsDir, builds[0].name);
const indexDir = path.join(indexRoot, 'index-code');
const stage2Receipt = JSON.parse(await fs.readFile(path.join(indexRoot, 'build_state.json'), 'utf8'));
assert.equal(stage2Receipt.runtime.attempts.at(-1).lifecycle, 'succeeded');
assert.equal(stage2Receipt.runtime.attempts.at(-1).embeddings.observation.state, 'not-started');
let calls = 0;
const embed = async (texts) => {
  calls += 1;
  return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]));
};
__setAdapterFactoryForTests(() => ({ embed, embedOne: async () => (await embed(['alpha']))[0], embedderPromise: null, provider: 'xenova' }));
try {
  for (let run = 0; run < 2; run += 1) {
    const config = parseBuildEmbeddingsArgs(['--repo', repoRoot, '--index-root', indexRoot, '--mode', 'code', '--progress', 'off']);
    assert.equal(config.configuredDims, null);
    assert.equal(config.useStubEmbeddings, false);
    const summary = await runBuildEmbeddingsWithConfig(config);
    const state = JSON.parse(await fs.readFile(path.join(indexDir, 'index_state.json'), 'utf8'));
    const vectors = JSON.parse(await fs.readFile(path.join(indexDir, 'dense_vectors_uint8.meta.json'), 'utf8'));
    assert.equal(state.embeddings.ready, true);
    assert.equal(state.embeddings.pending, false);
    const receipt = JSON.parse(await fs.readFile(path.join(indexRoot, 'build_state.json'), 'utf8'));
    const attempt = receipt.runtime.attempts.at(-1);
    assert.equal(receipt.buildId, stage2Receipt.buildId);
    assert.equal(attempt.lifecycle, 'succeeded');
    assert.equal(attempt.stage, 'stage3');
    assert.equal(attempt.embeddings.observation.provider, 'xenova');
    assert.equal(attempt.embeddings.observation.dims, 5);
    assert.equal(attempt.embeddings.observation.method, 'provider-probe');
    assert.equal(state.extensions.runtimeAttemptId, attempt.attemptId);
    assert.equal(state.extensions.runtimeEmbeddingObservation.dims, 5);
    assert.equal(receipt.runtime.attempts.filter((item) => item.stage === 'stage3').length, run + 1);
    assert.equal(state.embeddings.embeddingIdentity.dims, 5);
    assert.equal(vectors.dims, 5);
    assert.equal(state.embeddings.embeddingIdentityKey, buildEmbeddingIdentityKey(state.embeddings.embeddingIdentity));
    assert.equal(state.embeddings.embeddingIdentity.modelArtifact.status, 'unknown');
    assert.equal(state.embeddings.embeddingIdentity.modelArtifact.reuse, 'refuse');
    assert.equal(state.embeddings.cacheStats.hits, 0, 'unknown model artifacts must not authorize durable reuse');
    assert.deepEqual(attempt.runtime.writer, summary.writer.code, 'production runner persists the same drained writer snapshot it returns');
    assert.equal(attempt.runtime.writer.pending, 0);
    assert.equal(attempt.runtime.writer.pendingBytes, 0);
    assert.equal(attempt.runtime.writer.failed, 0);
    assert.ok(Number.isFinite(attempt.runtime.writer.maxPendingBytes));
  }
  assert(calls > 0, 'real-provider adapter must be exercised');
  for (const cancel of [false, true]) {
    const abort = new AbortController();
    let failureCalls = 0;
    const providerError = Object.assign(new Error('controlled provider write-phase failure'), { code: 'ERR_CONTROLLED_PROVIDER' });
    __setAdapterFactoryForTests(() => ({
      embed: async texts => {
        if (++failureCalls > 1) {
          if (cancel) { abort.abort(); throw createAbortError('controlled provider cancellation'); }
          throw providerError;
        }
        return texts.map(() => new Float32Array(5).fill(0.25));
      }, embedderPromise: null, provider: 'xenova'
    }));
    const config = parseBuildEmbeddingsArgs(['--repo', repoRoot, '--index-root', indexRoot, '--mode', 'code', '--progress', 'off']);
    config.signal = abort.signal;
    await assert.rejects(runBuildEmbeddingsWithConfig(config), cancel ? { name: 'AbortError' } : error => error === providerError);
    const receipt = JSON.parse(await fs.readFile(path.join(indexRoot, 'build_state.json'), 'utf8'));
    const attempt = receipt.runtime.attempts.at(-1);
    const state = JSON.parse(await fs.readFile(path.join(indexDir, 'index_state.json'), 'utf8'));
    assert.equal(attempt.lifecycle, cancel ? 'aborted' : 'failed');
    assert.equal(attempt.error.code, cancel ? 'ABORT_ERR' : 'ERR_CONTROLLED_PROVIDER');
    assert.equal(attempt.runtime.writer.pending, 0, 'terminal receipt captures drained writer ownership');
    assert.equal(attempt.runtime.writer.pendingBytes, 0);
    assert.equal(attempt.runtime.writer.producers, 0);
    assert.equal(state.embeddings.ready, false);
    assert.equal(state.embeddings.pending, false, 'terminal cleanup persists even after normal IO admission is aborted');
    assert.equal(state.extensions.runtimeAttemptId, attempt.attemptId);
  }
  let probeDisposals = 0;
  const probeError = Object.assign(new Error('controlled initial provider probe failure'), { code: 'ERR_CONTROLLED_PROBE' });
  __setAdapterFactoryForTests(() => ({
    embed: async () => { throw probeError; }, provider: 'xenova', embedderPromise: null,
    dispose: async () => { probeDisposals++; throw new Error('controlled cleanup failure'); }
  }));
  const probeConfig = parseBuildEmbeddingsArgs(['--repo', repoRoot, '--index-root', indexRoot, '--mode', 'code', '--progress', 'off']);
  let probeFailure;
  await assert.rejects(runBuildEmbeddingsWithConfig(probeConfig), error => {
    probeFailure = error;
    return error.code === 'ERR_CONTROLLED_PROBE' && errorGraphIncludes(error, probeError);
  });
  assert.equal(errorGraphMatches(probeFailure.cleanupError, /controlled cleanup failure/), true);
  assert.equal(probeError.cleanupError, undefined, 'outward cleanup context does not rewrite the original provider error');
  assert.equal(probeFailure.cacheOwnershipPending, true, 'cleanup failure remains observable without replacing the original provider code/name/cause');
  assert.equal(probeDisposals, 1, 'startup failure releases the provider lease exactly once and preserves its original error');
  const failedProbe = JSON.parse(await fs.readFile(path.join(indexRoot, 'build_state.json'), 'utf8')).runtime.attempts.at(-1);
  assert.equal(failedProbe.lifecycle, 'failed');
  assert.equal(failedProbe.error.code, 'ERR_CONTROLLED_PROBE');
} finally {
  __resetEmbeddingAdapterCachesForTests();
}
console.log('inferred embedding dimensions identity/cache regression passed');
