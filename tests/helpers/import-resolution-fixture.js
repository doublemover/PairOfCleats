import fs from 'node:fs/promises';

import { resolveTestCachePath } from './test-cache.js';

const root = process.cwd();

export const createImportResolutionTempRoot = async (name) => {
  const tempRoot = resolveTestCachePath(root, name);
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });
  return tempRoot;
};

export const createImportResolutionCacheStats = () => ({
  files: 0,
  filesHashed: 0,
  filesReused: 0,
  filesInvalidated: 0,
  specs: 0,
  specsReused: 0,
  specsComputed: 0,
  packageInvalidated: false,
  fileSetInvalidated: false,
  lookupReused: false,
  lookupInvalidated: false,
  invalidationReasons: Object.create(null),
  fileSetDelta: { added: 0, removed: 0 },
  filesNeighborhoodInvalidated: 0,
  staleEdgeInvalidated: 0,
  staleEdgeChecks: 0,
  staleEdgeBudgetExhausted: false
});
