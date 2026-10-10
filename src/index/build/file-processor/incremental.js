import { resolveStageRefresh } from '../incremental/stage-reuse.js';
import { readCachedBundle, writeIncrementalBundle } from '../incremental.js';

export async function loadCachedBundleForFile({
  repoRoot = process.cwd(),
  runIo,
  incrementalState,
  absPath,
  relKey,
  fileStat,
  semanticContext = null
}) {
  const result = await runIo(() => readCachedBundle({
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
