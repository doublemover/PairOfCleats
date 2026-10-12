import { readCachedBundle } from '../incremental.js';
import { validateChunkBounds } from '../file-processor/cpu/chunking.js';

export const resolveStageRefresh = (current, previous) => {
  const changed = key => !current?.[key] || current[key] !== previous?.[key];
  return {
    parse: changed('parse'),
    lexical: changed('lexical'),
    enrichment: changed('enrichment'),
    embeddings: changed('embeddings')
  };
};

// Checkpoints are optional acceleration, never a new failure mode for parsing.
export const captureChunkingCheckpoint = (chunks, diagnostics, textLength) => {
  try {
    const encoded = JSON.stringify({ chunks, diagnostics, textLength });
    return Buffer.byteLength(encoded) <= 16 * 1024 * 1024 ? JSON.parse(encoded) : null;
  } catch {
    return null;
  }
};

export const resolveChunkingCheckpoint = async ({ cached, textLength, chunker, input }) => {
  if (
    cached?.textLength === textLength
    && Array.isArray(cached.chunks)
    && !validateChunkBounds(cached.chunks, textLength)
    && cached.diagnostics
  ) {
    return {
      chunks: structuredClone(cached.chunks),
      chunkingDiagnostics: { ...cached.diagnostics },
      checkpointReused: true
    };
  }
  return chunker(input);
};

/** Bound preload work; uncached/changed files stay on the normal scheduler. */
export const preloadParseCheckpoints = async ({
  entries,
  incrementalState,
  maxBytes = 64 * 1024 * 1024,
  maxFiles = 1000
}) => {
  const reusable = new Set();
  let bytes = 0;
  if (!incrementalState?.enabled) return reusable;
  for (const entry of entries.slice(0, maxFiles)) {
    const relKey = entry.rel;
    const previous = incrementalState.manifest.files?.[relKey];
    if (resolveStageRefresh(
      incrementalState.manifest.dependencySignatures,
      previous?.dependencySignatures
    ).parse) continue;
    const loaded = await readCachedBundle({
      enabled: true,
      absPath: entry.abs,
      relKey,
      fileStat: entry.stat,
      manifest: incrementalState.manifest,
      bundleDir: incrementalState.bundleDir,
      bundleFormat: incrementalState.bundleFormat,
      sharedReadState: incrementalState.readHashCache
    });
    const checkpoint = loaded.cachedBundle?.parseCheckpoint;
    if (
      !checkpoint?.diagnostics
      || !Number.isFinite(checkpoint.textLength)
      || validateChunkBounds(checkpoint.chunks, checkpoint.textLength)
    ) continue;
    const size = Buffer.byteLength(JSON.stringify(checkpoint));
    if (bytes + size > maxBytes) continue;
    bytes += size;
    reusable.add(entry.abs);
  }
  return reusable;
};
