import { writeHnswIndex } from './hnsw.js';
import { writeLanceDbIndex, shouldIsolateLanceDb } from './lancedb.js';
import { getLanceDbEnv } from '../../../src/shared/env/runtime.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { runIsolatedBackendJobs } from './backend-isolate.js';

export const writeHnswBackends = async ({
  mode,
  hnswConfig,
  hnswIsolate,
  isolateState,
  hnswPaths,
  vectors,
  vectorsPaths,
  modelId,
  dims,
  quantization,
  scale,
  normalize,
  logger,
  log,
  warn,
  signal = null,
  recordFailure = null,
  reuse = null
} = {}) => {
  const results = {
    merged: null,
    doc: null,
    code: null
  };
  if (!hnswConfig?.enabled) return results;
  let isolateEnabled = hnswIsolate === true;
  const isolateFailureMessage = isolateState?.disabled === true
    ? (isolateState?.reason || 'HNSW isolate disabled after previous failure.')
    : null;
  if (isolateState?.disabled === true) {
    isolateEnabled = false;
  }
  let loggedReuseAfterFallback = false;

  const entries = [
    {
      target: 'merged',
      label: `${mode}/merged`,
      paths: hnswPaths?.merged,
      vectors: vectors?.merged,
      vectorsPath: vectorsPaths?.merged
    },
    {
      target: 'doc',
      label: `${mode}/doc`,
      paths: hnswPaths?.doc,
      vectors: vectors?.doc,
      vectorsPath: vectorsPaths?.doc
    },
    {
      target: 'code',
      label: `${mode}/code`,
      paths: hnswPaths?.code,
      vectors: vectors?.code,
      vectorsPath: vectorsPaths?.code
    }
  ];
  const reuseWork = { reusedVariants: 0, copiedBytes: 0, reuseInvalidations: Object.create(null) };
  if (reuse) for (const entry of entries) {
    throwIfAborted(signal);
    const proof = await reuse({ backend: 'hnsw', variant: entry.target, config: hnswConfig });
    if (proof.reused) { results[entry.target] = proof.result; reuseWork.reusedVariants++; reuseWork.copiedBytes += proof.work?.copiedBytes || 0; }
    else reuseWork.reuseInvalidations[proof.reason] = (reuseWork.reuseInvalidations[proof.reason] || 0) + 1;
  }

  if (isolateEnabled) {
    const jobs = entries.filter(entry => !results[entry.target] && entry.paths && entry.vectorsPath).map(entry => ({ target: entry.target,
      payload: { indexPath: entry.paths.indexPath, metaPath: entry.paths.metaPath, modelId, dims, quantization,
        scale, vectorsPath: entry.vectorsPath, normalize, config: hnswConfig } }));
    const batch = await runIsolatedBackendJobs({ backend: 'hnsw', jobs, signal,
      ownershipId: `stage3-ann:hnsw:${mode}`, recordFailure });
    Object.assign(results, batch.results);
    Object.defineProperty(results, 'work', { value: { ...batch.work, ...reuseWork } });
    for (const entry of entries) {
      const result = results[entry.target];
      if (!result) results[entry.target] = { skipped: true, reason: 'missing vectors path for isolate' };
      else if (result.skipped && result.error) warn(`[embeddings] ${entry.label}: HNSW isolate failed: ${result.error.message}`);
      else if (!result.skipped) log(`[embeddings] ${entry.label}: wrote HNSW index (${result.count} vectors).`);
    }
    return results;
  }

  for (const entry of entries) {
    throwIfAborted(signal);
    if (results[entry.target]) continue;
    if (!entry.paths) continue;
    try {
      results[entry.target] = await writeHnswIndex({ indexPath: entry.paths.indexPath,
        metaPath: entry.paths.metaPath, modelId, dims, quantization, scale, vectors: entry.vectors,
        vectorsPath: entry.vectorsPath, normalize, config: hnswConfig, isolate: false, logger, signal });
      if (isolateFailureMessage && !loggedReuseAfterFallback) {
        log(`[embeddings] ${mode}: using configured in-process HNSW writer (${isolateFailureMessage}).`);
        loggedReuseAfterFallback = true;
      }
      if (results[entry.target] && !results[entry.target].skipped) {
        log(`[embeddings] ${entry.label}: wrote HNSW index (${results[entry.target].count} vectors).`);
      }
    } catch (err) {
      throwIfAborted(signal);
      warn(`[embeddings] ${entry.label}: failed to write HNSW index: ${err?.message || err}`);
    }
  }

  Object.defineProperty(results, 'work', { value: { childStarts: 0, ...reuseWork } });
  return results;
};

export const writeLanceDbBackends = async ({
  mode,
  indexDir,
  lanceConfig,
  vectors,
  vectorsPaths,
  dims,
  modelId,
  quantization,
  scale,
  normalize,
  logger,
  warn,
  signal = null,
  recordFailure = null,
  reuse = null
} = {}) => {
  const results = { merged: null, doc: null, code: null };
  if (!lanceConfig?.enabled) return results;
  const entries = [
    {
      variant: 'merged',
      label: `${mode}/merged`,
      vectors: vectors?.merged,
      vectorsPath: vectorsPaths?.merged
    },
    {
      variant: 'doc',
      label: `${mode}/doc`,
      vectors: vectors?.doc,
      vectorsPath: vectorsPaths?.doc
    },
    {
      variant: 'code',
      label: `${mode}/code`,
      vectors: vectors?.code,
      vectorsPath: vectorsPaths?.code
    }
  ];
  const reuseWork = { reusedVariants: 0, copiedBytes: 0, reuseInvalidations: Object.create(null) };
  if (reuse) for (const entry of entries) {
    throwIfAborted(signal);
    const proof = await reuse({ backend: 'lancedb', variant: entry.variant, config: lanceConfig });
    if (proof.reused) { results[entry.variant] = proof.result; reuseWork.reusedVariants++; reuseWork.copiedBytes += proof.work?.copiedBytes || 0; }
    else reuseWork.reuseInvalidations[proof.reason] = (reuseWork.reuseInvalidations[proof.reason] || 0) + 1;
  }

  if (shouldIsolateLanceDb(lanceConfig, getLanceDbEnv())) {
    const jobs = entries.filter(entry => !results[entry.variant] && entry.vectorsPath).map(entry => ({ target: entry.variant,
      payload: { indexDir, variant: entry.variant, vectorsPath: entry.vectorsPath, dims, modelId,
        quantization, scale, normalize, config: lanceConfig, label: entry.label } }));
    const batch = await runIsolatedBackendJobs({ backend: 'lancedb', jobs, signal,
      ownershipId: `stage3-ann:lancedb:${mode}`, recordFailure });
    Object.assign(results, batch.results);
    Object.defineProperty(results, 'work', { value: { ...batch.work, ...reuseWork } });
    for (const entry of entries) {
      const result = results[entry.variant];
      if (!result) results[entry.variant] = { skipped: true, reason: 'missing vectors path for isolate' };
      else if (result.skipped && result.error) warn(`[embeddings] ${entry.label}: LanceDB isolate failed: ${result.error.message}`);
    }
    return results;
  }

  for (const entry of entries) {
    throwIfAborted(signal);
    if (results[entry.variant]) continue;
    try {
      const result = await writeLanceDbIndex({
        indexDir,
        variant: entry.variant,
        vectors: entry.vectors,
        vectorsPath: entry.vectorsPath,
        dims,
        modelId,
        quantization,
        scale,
        normalize,
        config: lanceConfig,
        emitOutput: true,
        label: entry.label,
        logger,
        signal
      });
      results[entry.variant] = result;
    } catch (err) {
      throwIfAborted(signal);
      warn(`[embeddings] ${entry.label}: failed to write LanceDB index: ${err?.message || err}`);
    }
  }
  Object.defineProperty(results, 'work', { value: { childStarts: 0, ...reuseWork } });
  return results;
};
