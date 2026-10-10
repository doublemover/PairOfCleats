import { resolveStageRefresh } from '../incremental/stage-reuse.js';
import { readCachedBundle, writeIncrementalBundle } from '../incremental.js';
import fs from 'node:fs/promises';
import { readFileCompletion } from '../incremental/file-completion.js';

export async function loadCachedBundleForFile({
  repoRoot = process.cwd(),
  runIo,
  incrementalState,
  absPath,
  relKey,
  fileStat,
  semanticContext = null
}) {
  const read = () => runIo(() => readCachedBundle({
    repoRoot,
    enabled: incrementalState.enabled,
    absPath,
    relKey,
    fileStat,
    manifest: incrementalState.manifest,
    bundleDir: incrementalState.bundleDir,
    bundleFormat: incrementalState.bundleFormat,
    semanticContext,
    sharedReadState: incrementalState.readHashCache || null
  }));
  let result = await read();
  if (!result.cachedBundle && semanticContext && incrementalState.enabled) {
    const sourceBytes = result.buffer || await runIo(() => fs.readFile(absPath));
    const completed = await runIo(() => readFileCompletion({
      bundleDir: incrementalState.bundleDir, relKey, sourceBytes, semanticContext
    }));
    if (completed) {
      incrementalState.manifest.files[relKey] = completed.manifestEntry;
      result = await read();
      if (result.cachedBundle?.chunks?.length !== completed.chunkCount) {
        result = { cachedBundle: null, fileHash: result.fileHash, buffer: sourceBytes };
      } else if (result.cachedBundle) {
        result.cachedBundle.lexiconFilterStats = completed.lexiconFilterStats;
      }
    }
  }
  if (result.cachedBundle) result.cachedBundle.stageRefresh = resolveStageRefresh(incrementalState.manifest.dependencySignatures, incrementalState.manifest.files?.[relKey]?.dependencySignatures);
  return result;
}

export async function writeBundleForFile({
  runIo,
  incrementalState,
  relKey,
  fileStat,
  fileHash,
  fileChunks,
  parseCheckpoint = null,
  semanticFactsRef = null,
  semanticSegmentFactsRefs = [],
  semanticEvidenceArtifacts = [],
  semanticContext = null,
  fileRelations,
  lexiconFilterStats = null,
  vfsManifestRows,
  fileEncoding = null,
  fileEncodingFallback = null,
  fileEncodingFallbackClass = null,
  fileEncodingFallbackRisk = null,
  fileEncodingConfidence = null
}) {
  return runIo(() => writeIncrementalBundle({
    enabled: incrementalState.enabled,
    bundleDir: incrementalState.bundleDir,
    manifest: incrementalState.manifest,
    relKey,
    fileStat,
    fileHash,
    fileChunks,
    parseCheckpoint,
    semanticFactsRef, semanticSegmentFactsRefs, semanticEvidenceArtifacts,
    semanticContext,
    dependencySignatures: incrementalState.manifest.dependencySignatures,
    fileRelations,
    lexiconFilterStats,
    vfsManifestRows,
    bundleFormat: incrementalState.bundleFormat,
    previousManifestEntry: incrementalState.manifest?.files?.[relKey] || null,
    fileEncoding,
    fileEncodingFallback,
    fileEncodingFallbackClass,
    fileEncodingFallbackRisk,
    fileEncodingConfidence
  }));
}
