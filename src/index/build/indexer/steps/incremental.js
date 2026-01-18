import { loadIncrementalState, pruneIncrementalManifest, shouldReuseIncrementalIndex, updateBundlesWithChunks } from '../../incremental.js';
import { configureGitMetaCache } from '../../../git.js';
import { log } from '../../../../shared/progress.js';

export const loadIncrementalPlan = async ({
  runtime,
  mode,
  outDir,
  entries,
  tokenizationKey,
  cacheSignature,
  cacheReporter
}) => {
  const incrementalState = await loadIncrementalState({
    repoCacheRoot: runtime.repoCacheRoot,
    mode,
    enabled: runtime.incrementalEnabled,
    tokenizationKey,
    cacheSignature,
    bundleFormat: runtime.incrementalBundleFormat,
    log
  });
  configureGitMetaCache(runtime.cacheConfig?.gitMeta, cacheReporter);
  let reused = false;
  if (incrementalState?.enabled) {
    const reuse = await shouldReuseIncrementalIndex({
      outDir,
      entries,
      manifest: incrementalState.manifest,
      stage: runtime.stage
    });
    if (reuse) {
      log(`→ Reusing ${mode} index artifacts (no changes).`);
      reused = true;
    }
  }
  return { incrementalState, reused };
};

export const pruneIncrementalState = async ({ runtime, incrementalState, seenFiles }) => {
  await pruneIncrementalManifest({
    enabled: runtime.incrementalEnabled,
    manifest: incrementalState.manifest,
    manifestPath: incrementalState.manifestPath,
    bundleDir: incrementalState.bundleDir,
    seenFiles
  });
};

export const updateIncrementalBundles = async ({ runtime, incrementalState, state, log: logFn }) => {
  await updateBundlesWithChunks({
    enabled: runtime.incrementalEnabled,
    manifest: incrementalState.manifest,
    bundleDir: incrementalState.bundleDir,
    bundleFormat: incrementalState.bundleFormat,
    chunks: state.chunks,
    fileRelations: state.fileRelations,
    log: logFn
  });
};
