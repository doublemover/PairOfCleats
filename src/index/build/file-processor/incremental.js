import { readCachedBundle, writeIncrementalBundle } from '../incremental.js';

export async function loadCachedBundleForFile({
  runIo,
  incrementalState,
  absPath,
  relKey,
  fileStat
}) {
  return runIo(() => readCachedBundle({
    enabled: incrementalState.enabled,
    absPath,
    relKey,
    fileStat,
    manifest: incrementalState.manifest,
    bundleDir: incrementalState.bundleDir,
    bundleFormat: incrementalState.bundleFormat
  }));
}

export async function writeBundleForFile({
  runIo,
  incrementalState,
  relKey,
  fileStat,
  fileHash,
  fileChunks,
  fileRelations,
  fileEncoding = null,
  fileEncodingFallback = null,
  fileEncodingConfidence = null
}) {
  return runIo(() => writeIncrementalBundle({
    enabled: incrementalState.enabled,
    bundleDir: incrementalState.bundleDir,
    relKey,
    fileStat,
    fileHash,
    fileChunks,
    fileRelations,
    bundleFormat: incrementalState.bundleFormat,
    fileEncoding,
    fileEncodingFallback,
    fileEncodingConfidence
  }));
}
