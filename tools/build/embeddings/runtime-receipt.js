import path from 'node:path';
import fs from 'node:fs/promises';
import { createRuntimeAttempt, observeRuntimePath, projectRuntimeScheduler } from '../../../src/shared/runtime-envelope/receipt.js';
import { readRuntimeReceipt } from '../../../src/shared/runtime-envelope/read-receipt.js';
import { resolveCurrentProcessRuntimeEnvelope } from '../../../src/shared/runtime-envelope/resolve-current-process-envelope.js';
import { parseObservabilityContextEnv } from '../../../src/shared/observability.js';
import { persistRuntimeAttempt } from '../../../src/index/build/build-state/runtime.js';
import { initBuildState } from '../../../src/index/build/build-state.js';
import { getToolVersion } from '../../shared/dict-utils.js';
import { redactDiagnosticText } from '../../../src/shared/diagnostic-text.js';

export const createStage3RuntimeReceipts = async ({ config, roots, identity, identityKey, log }) => {
  const entries = new Map();
  const observability = parseObservabilityContextEnv(config.rawEnv || process.env);
  const envelope = resolveCurrentProcessRuntimeEnvelope({ argv: config.argv, rawArgv: config.rawArgv, userConfig: config.userConfig, env: config.rawEnv || process.env });
  const validated = [];
  for (const [mode, buildRoot] of roots) {
    if (!buildRoot || !(await fs.stat(buildRoot)).isDirectory()) throw Object.assign(new Error('Stage3 requires an existing build root.'), { code: 'ERR_RUNTIME_RECEIPT_ROOT' });
    const existing = await readRuntimeReceipt({ buildRoot });
    const actualBuildId = existing.buildId || existing.legacy?.buildId || null;
    const expectedBuildId = config.executionPlan?.buildId;
    if (expectedBuildId && actualBuildId !== expectedBuildId) throw Object.assign(new Error('Embedding execution plan build generation does not match persisted build state.'), { code: 'ERR_EMBEDDING_PLAN_GENERATION' });
    if (existing.errorCode && existing.errorCode !== 'ENOENT') throw Object.assign(new Error(`Cannot read stage3 runtime state: ${existing.errorCode}`), { code: 'ERR_RUNTIME_RECEIPT_PERSIST' });
    if (existing.evidence === 'unsupported-runtime-receipt') throw Object.assign(new Error('Unsupported runtime receipt version; refusing to overwrite evidence.'), { code: 'ERR_RUNTIME_RECEIPT_CONTRACT' });
    if (!existing.errorCode && (await readRuntimeReceipt({ buildRoot, requireProducerIdentity: true })).errorCode) throw Object.assign(new Error('Invalid existing build state; refusing to overwrite evidence.'), { code: 'ERR_RUNTIME_RECEIPT_CONTRACT' });
    validated.push({ mode, buildRoot, existing, buildId: actualBuildId || 'unknown' });
  }
  try {
    for (const { mode, buildRoot, existing, buildId } of validated) {
      if (existing.errorCode === 'ENOENT') await initBuildState({ buildRoot, buildId, repoRoot: config.root, stage: 'stage3', modes: [mode], toolVersion: getToolVersion() });
      const attempt = await createRuntimeAttempt({
        buildId, stage: 'stage3', mode, observability, envelope, executionClass: 'cli-child', toolVersion: getToolVersion(),
        paths: { repo: config.root, repoCache: config.repoCacheRoot, build: buildRoot, index: path.join(buildRoot, `index-${mode}`), models: config.modelsDir },
        inputs: { configSources: config.configSources, resolvedPlanDigest: config.executionPlan?.digest || null, selectedAt: config.executionPlan?.selectedAt || null, resourcePolicy: config.executionPlan?.resourcePolicy || null },
        embeddings: { requested: { modelId: config.modelId, provider: config.embeddingProvider, stub: config.useStubEmbeddings }, resolvedIdentity: identity, identityKey,
          observation: { state: 'not-started', provider: null, dims: null, observedAt: null, method: null } }
      });
      await persistRuntimeAttempt(buildRoot, attempt, { lifecycle: 'initializing' });
      entries.set(mode, { buildRoot, attempt, inferenceBatches: 0, write: Promise.resolve() });
      log(`[runtime] attempt ${attempt.attemptId}; receipt: ${path.join(buildRoot, 'build_state.json')} (durable).`);
    }
  } catch (error) {
    for (const { buildRoot, attempt } of entries.values()) await persistRuntimeAttempt(buildRoot, attempt, { lifecycle: 'failed', error: { code: String(error?.code || 'UNKNOWN'), message: redactDiagnosticText(error?.message || error) } });
    throw error;
  }
  const selected = (mode) => mode ? [entries.get(mode)].filter(Boolean) : Array.from(entries.values());
  const change = async (mode, patch) => {
    await Promise.all(selected(mode).map((entry) => {
      const work = entry.write.then(() => {
        const next = patch.embeddings?.observation;
        const prior = entry.attempt.embeddings?.observation;
        if (Object.keys(patch).length === 1 && next && prior
          && ['state', 'provider', 'dims', 'method'].every((key) => next[key] === prior[key])) return entry.attempt;
        return persistRuntimeAttempt(entry.buildRoot, entry.attempt, patch);
      });
      entry.write = work.catch(() => {});
      return work;
    }));
  };
  return {
    reference: (mode) => entries.get(mode)?.attempt?.attemptId || null,
    observation: (mode) => entries.get(mode)?.attempt?.embeddings?.observation || null,
    async loading(mode) {
      if (selected(mode).every((entry) => ['loading', 'ready'].includes(entry.attempt.embeddings.observation.state))) return;
      await change(mode, { embeddings: { ...selected(mode)[0]?.attempt.embeddings, observation: { state: 'loading', provider: null, dims: null, observedAt: new Date().toISOString(), method: 'provider-request-started' } } });
    },
    async observed(mode, embedder, vectors, method = 'successful-inference') {
      const dims = vectors?.[0]?.length;
      const provider = embedder.getActiveProvider();
      if (!Array.isArray(vectors) || !dims || vectors.some((vector) => !vector || vector.length !== dims)) throw Object.assign(new Error('Observed embedding batch has inconsistent dimensions.'), { code: 'ERR_EMBEDDING_DIMS_MISMATCH' });
      for (const entry of selected(mode)) {
        const expected = entry.attempt.embeddings.resolvedIdentity;
        const prior = entry.attempt.embeddings.observation;
        if ((expected?.dims && expected.dims !== dims) || (prior.state === 'ready' && prior.dims !== dims)) throw Object.assign(new Error('Embedding dimensions changed after identity selection.'), { code: 'ERR_EMBEDDING_DIMS_MISMATCH' });
        if (!(method === 'provider-probe' && entry.attempt.lifecycle === 'initializing') && expected?.provider && expected.provider !== provider) {
          await change(entry.attempt.mode, { embeddings: { ...entry.attempt.embeddings, observation: { state: 'failed', provider, requestedProvider: expected.provider, dims, observedAt: new Date().toISOString(), method: 'provider-changed-after-identity-selection' } } });
          throw Object.assign(new Error(`Embedding provider changed after identity selection. Retry with indexing.embeddings.provider=${provider}.`), { code: 'ERR_EMBEDDING_PROVIDER_CHANGED' });
        }
      }
      for (const entry of selected(mode)) if (method !== 'provider-probe') entry.inferenceBatches += 1;
      if (selected(mode).every((entry) => entry.attempt.embeddings.observation.state === 'ready')) return;
      const info = embedder.executionInfo?.() || {};
      await change(mode, { embeddings: { ...selected(mode)[0]?.attempt.embeddings, observation: {
        state: 'ready', provider: embedder.getActiveProvider(), dims, observedAt: new Date().toISOString(), method,
        stub: config.useStubEmbeddings === true, device: info.device ?? null, dtype: info.dtype ?? null,
        modelRevision: info.modelRevision ?? null, modelArtifact: info.modelArtifact ?? null,
        requestedSessionOptions: info.requestedSessionOptions ?? null, sessionOptions: info.effectiveSessionOptions ?? null,
        effectiveNativeThreads: info.effectiveNativeThreads ?? null
      } } });
    },
    async resolved(nextIdentity, nextKey, scheduler) {
      for (const [mode, entry] of entries) await change(mode, { lifecycle: 'running', runtime: { scheduler: projectRuntimeScheduler(scheduler?.stats?.()) }, embeddings: { ...entry.attempt.embeddings, resolvedIdentity: nextIdentity, identityKey: nextKey } });
    },
    async ready(mode, { cacheHits, totalChunks, scheduler, writer, cacheRoot }) {
      const entry = entries.get(mode);
      const observation = entry.attempt.embeddings.observation;
      await change(mode, { runtime: { scheduler: projectRuntimeScheduler(scheduler?.stats?.()), writer: writer || null },
        paths: { ...entry.attempt.paths, embeddingCache: await observeRuntimePath(cacheRoot) },
        embeddings: { ...entry.attempt.embeddings, inferenceBatches: entry.inferenceBatches, cacheHits, totalChunks,
          observation: !entry.inferenceBatches && cacheHits > 0 && observation.method !== 'provider-probe'
            ? { ...observation, state: 'cache-only', method: 'validated-cache-reuse', observedAt: new Date().toISOString() } : observation } });
    },
    complete: (mode) => change(mode, { lifecycle: 'succeeded' }),
    fail: async (error, mode = null) => {
      for (const entry of selected(mode)) {
        if (entry.attempt.lifecycle === 'succeeded') continue;
        await change(entry.attempt.mode, { lifecycle: error?.name === 'AbortError' ? 'aborted' : 'failed',
          error: { code: String(error?.code || 'UNKNOWN'), message: redactDiagnosticText(error?.message || error) },
          embeddings: { ...entry.attempt.embeddings, observation: { ...entry.attempt.embeddings.observation, state: 'failed', observedAt: new Date().toISOString() } } });
      }
    }
  };
};
