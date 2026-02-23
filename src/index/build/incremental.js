/**
 * Incremental build facade.
 *
 * This module preserves the historical import surface for callers while the
 * implementation is split across focused incremental submodules.
 */
export { loadIncrementalState, shouldReuseIncrementalIndex } from './incremental/planning.js';
export { readCachedBundle, readCachedImports } from './incremental/state-reconciliation.js';
export {
  writeIncrementalBundle,
  pruneIncrementalManifest,
  preloadIncrementalBundleVfsRows,
  updateBundlesWithChunks
} from './incremental/writeback.js';
