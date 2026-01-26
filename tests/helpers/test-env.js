import path from 'node:path';
import { fileURLToPath } from 'node:url';

const resolveDefaultCacheRoot = () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  return path.join(root, '.testCache');
};

export const applyTestEnv = ({ cacheRoot, embeddings } = {}) => {
  process.env.PAIROFCLEATS_TESTING = '1';
  if (!process.env.PAIROFCLEATS_CACHE_ROOT) {
    process.env.PAIROFCLEATS_CACHE_ROOT = resolveDefaultCacheRoot();
  }
  if (cacheRoot) process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
  if (embeddings) process.env.PAIROFCLEATS_EMBEDDINGS = embeddings;
};

applyTestEnv();
