import {
  loadIncrementalState,
  preloadIncrementalBundleVfsRows,
  pruneIncrementalManifest,
  shouldReuseIncrementalIndex,
  updateBundlesWithChunks
} from '../../incremental.js';
import { configureScmMetaCache } from '../../../scm/cache.js';
import { setRecordsIncrementalCapability } from '../../../../storage/sqlite/build/index.js';
import { log } from '../../../../shared/progress.js';

/**
 * Load incremental state and decide whether current mode can be reused.
 *
 * @param {object} input
 * @returns {Promise<{incrementalState:object,reused:boolean}>}
 */
export const loadIncrementalPlan = async ({
  runtime,
  mode,
  outDir,
  entries,
  tokenizationKey,
  cacheSignature,
  cacheSignatureSummary,
  cacheReporter
}) => {
  const incrementalState = await loadIncrementalState({
    repoCacheRoot: runtime.repoCacheRoot,
    mode,
    enabled: runtime.incrementalEnabled,
    tokenizationKey,
    cacheSignature,
    cacheSignatureSummary,
    bundleFormat: runtime.incrementalBundleFormat,
    log
  });
  if (incrementalState?.manifest) {
    incrementalState.manifest.bundleEmbeddings = runtime.embeddingEnabled === true;
    incrementalState.manifest.bundleEmbeddingMode = runtime.embeddingMode || null;
    incrementalState.manifest.bundleEmbeddingIdentityKey = runtime.embeddingIdentityKey || null;
    incrementalState.manifest.bundleEmbeddingStage = runtime.stage || null;
    if (mode === 'records') {
      setRecordsIncrementalCapability(incrementalState.manifest, true);
    }
  }
  configureScmMetaCache({
    provider: runtime.scmProvider,
    cacheConfig: runtime.cacheConfig?.gitMeta,
    reporter: cacheReporter
  });
  let reused = false;
  if (incrementalState?.enabled) {
    const reuse = await shouldReuseIncrementalIndex({
      outDir,
      entries,
      manifest: incrementalState.manifest,
      stage: runtime.stage,
      log,
      explain: runtime.verboseCache === true
    });
    if (reuse) {
      log(`→ Reusing ${mode} index artifacts (no changes).`);
      reused = true;
    }
  }
  return { incrementalState, reused };
};

/**
 * Prune incremental manifest entries not seen in current discovery set.
 *
 * @param {{runtime:object,incrementalState:object,seenFiles:Set<string>|string[]}} input
 * @returns {Promise<void>}
 */
export const pruneIncrementalState = async ({ runtime, incrementalState, seenFiles }) => {
  await pruneIncrementalManifest({
    enabled: runtime.incrementalEnabled,
    manifest: incrementalState.manifest,
    manifestPath: incrementalState.manifestPath,
    bundleDir: incrementalState.bundleDir,
    seenFiles
  });
};

/**
 * Preload incremental bundle VFS rows for faster unchanged-file reuse.
 *
 * @param {{runtime:object,incrementalState:object,enabled?:boolean}} input
 * @returns {Promise<object|null>|null}
 */
export const prepareIncrementalBundleVfsRows = ({
  runtime,
  incrementalState,
  enabled = true
}) => {
  if (enabled !== true) return null;
  return preloadIncrementalBundleVfsRows({
    enabled: runtime.incrementalEnabled,
    manifest: incrementalState.manifest,
    bundleDir: incrementalState.bundleDir,
    bundleFormat: incrementalState.bundleFormat,
    concurrency: runtime.ioConcurrency
  }).catch((err) => {
    log(`[incremental] bundle VFS prefetch skipped: ${err?.message || err}`);
    return null;
  });
};

/**
 * Update incremental bundles with latest chunk + relation outputs.
 *
 * @param {object} input
 * @returns {Promise<void>}
 */
export const updateIncrementalBundles = async ({
  runtime,
  incrementalState,
  state,
  existingVfsManifestRowsByFile = null,
  log: logFn
}) => {
  await updateBundlesWithChunks({
    enabled: runtime.incrementalEnabled,
    manifest: incrementalState.manifest,
    bundleDir: incrementalState.bundleDir,
    bundleFormat: incrementalState.bundleFormat,
    chunks: state.chunks,
    fileRelations: state.fileRelations,
    existingVfsManifestRowsByFile,
    log: logFn
  });
};
