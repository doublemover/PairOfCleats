import { writeHnswIndex } from './hnsw.js';
import { writeLanceDbIndex } from './lancedb.js';

export const writeHnswBackends = async ({
  mode,
  hnswConfig,
  hnswIsolate,
  isolateState,
  hnswBuilders,
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
  warn
} = {}) => {
  const results = {
    merged: null,
    doc: null,
    code: null
  };
  if (!hnswConfig?.enabled) return results;
  let isolateEnabled = hnswIsolate === true;
  let isolateFailureMessage = isolateState?.disabled === true
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

  for (const entry of entries) {
    if (!entry.paths) continue;
    try {
      if (isolateEnabled) {
        try {
          results[entry.target] = await writeHnswIndex({
            indexPath: entry.paths.indexPath,
            metaPath: entry.paths.metaPath,
            modelId,
            dims,
            quantization,
            scale,
            vectors: entry.vectors,
            vectorsPath: entry.vectorsPath,
            normalize,
            config: hnswConfig,
            isolate: true,
            logger
          });
        } catch (err) {
          isolateEnabled = false;
          isolateFailureMessage = err?.message || String(err);
          if (isolateState && typeof isolateState === 'object') {
            isolateState.disabled = true;
            isolateState.reason = isolateFailureMessage;
          }
          warn(
            `[embeddings] ${entry.label}: HNSW isolate failed; falling back to in-process writer ` +
            `(${isolateFailureMessage}).`
          );
          results[entry.target] = await writeHnswIndex({
            indexPath: entry.paths.indexPath,
            metaPath: entry.paths.metaPath,
            modelId,
            dims,
            quantization,
            scale,
            vectors: entry.vectors,
            vectorsPath: entry.vectorsPath,
            normalize,
            config: hnswConfig,
            isolate: false,
            logger
          });
        }
      } else {
        const builder = hnswBuilders?.[entry.target];
        if (builder) {
          results[entry.target] = await builder.writeIndex({
            indexPath: entry.paths.indexPath,
            metaPath: entry.paths.metaPath,
            modelId,
            dims,
            quantization,
            scale
          });
        } else {
          results[entry.target] = await writeHnswIndex({
            indexPath: entry.paths.indexPath,
            metaPath: entry.paths.metaPath,
            modelId,
            dims,
            quantization,
            scale,
            vectors: entry.vectors,
            vectorsPath: entry.vectorsPath,
            normalize,
            config: hnswConfig,
            isolate: false,
            logger
          });
          if (isolateFailureMessage) {
            if (!loggedReuseAfterFallback) {
              log(
                `[embeddings] ${mode}: using in-process HNSW writer ` +
                `after isolate fallback (${isolateFailureMessage}).`
              );
              loggedReuseAfterFallback = true;
            }
          }
        }
      }
      if (results[entry.target] && !results[entry.target].skipped) {
        log(`[embeddings] ${entry.label}: wrote HNSW index (${results[entry.target].count} vectors).`);
      }
    } catch (err) {
      warn(`[embeddings] ${entry.label}: failed to write HNSW index: ${err?.message || err}`);
    }
  }

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
  warn
} = {}) => {
  if (!lanceConfig?.enabled) return;
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

  try {
    for (const entry of entries) {
      let result = await writeLanceDbIndex({
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
        logger
      });
      // Keep isolate-by-default behavior, but recover in-process when isolate
      // fails so stage3 does not end up with partial backend state.
      if (result?.skipped && result.reason === 'isolate failed'
        && Array.isArray(entry.vectors) && entry.vectors.length > 0) {
        result = await writeLanceDbIndex({
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
          skipIsolate: true,
          emitOutput: true,
          label: entry.label,
          logger
        });
      }
    }
  } catch (err) {
    warn(`[embeddings] ${mode}: failed to write LanceDB indexes: ${err?.message || err}`);
  }
};
