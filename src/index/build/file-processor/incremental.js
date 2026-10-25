import { readParseCheckpointDescriptor } from '../incremental/parse-checkpoint-descriptor.js';
import { readVerifiedContainedFile } from '../../../shared/contained-file.js';
import { resolveStageRefresh } from '../incremental/stage-reuse.js';
import { readCachedBundle, writeIncrementalBundle } from '../incremental.js';
import { readIncrementalSourceSnapshot, isIncrementalSourceMiss } from '../incremental/source-snapshot.js';
import { readFileCompletion } from '../incremental/file-completion.js';
import { composeAbortSignals } from '../../../shared/abort.js';

export async function loadCachedBundleForFile({
  repoRoot = process.cwd(),
  runIo,
  incrementalState,
  absPath,
  relKey,
  fileStat,
  semanticContext = null,
  signal = null
}) {
  if (semanticContext) semanticContext = { ...semanticContext, signal: composeAbortSignals(signal, semanticContext.signal) };
  if (semanticContext && incrementalState.semanticReplayVerification) semanticContext = {
    ...semanticContext, replayVerification: incrementalState.semanticReplayVerification
  };
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
    signal,
    sharedReadState: incrementalState.readHashCache || null
  }));
  let result = await read();
  if (!result.cachedBundle && semanticContext && incrementalState.enabled) {
    let sourceBytes = result.buffer;
    if (!sourceBytes) {
      try { sourceBytes = (await runIo(() => readIncrementalSourceSnapshot({ repoRoot, absPath, fileStat,
        relKey, sharedReadState: incrementalState.readHashCache, signal: semanticContext.signal }), { waitOnly: true })).buffer; }
      catch (error) { if (!isIncrementalSourceMiss(error)) throw error; return result; }
    }
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
  if (!result.cachedBundle && !semanticContext && incrementalState.enabled) {
    const previous = incrementalState.manifest.files?.[relKey];
    if (previous?.parseCheckpointDescriptor && !resolveStageRefresh(
      incrementalState.manifest.dependencySignatures, previous.dependencySignatures).parse) {
      const checkpoint = await runIo(() => readParseCheckpointDescriptor({
        bundleDir: incrementalState.bundleDir, relKey, entry: previous }));
      if (checkpoint) {
        // The checkpoint is independent of missing/corrupt lexical shards, but
        // source identity must be fresh even when a prior stat/hash observation
        // exists in this attempt's ordinary bundle cache.
        try {
          const current = await runIo(() => readVerifiedContainedFile(repoRoot, absPath, {
            expectedStat: fileStat, expectedBytes: previous.size, expectedHash: previous.hash, hashAlgorithm: 'sha1', signal }));
          result = { ...result, fileHash: current.hash, buffer: current.buffer,
            parseCheckpointFallback: { sourceHash: current.hash, checkpoint } };
        } catch (error) {
          if (!isIncrementalSourceMiss(error)) throw error;
        }
      }
    }
  }
  if (result.cachedBundle && result.semanticFactsRef) semanticContext?.replayVerification?.recordReplay(
    result.semanticReplayToken, result.semanticFactsRef, result.semanticReplayVerificationReceipt);
  delete result.semanticReplayToken;
  delete result.semanticReplayVerificationReceipt;
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
  lexicalCheckpoint = null,
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
    lexicalCheckpoint,
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
