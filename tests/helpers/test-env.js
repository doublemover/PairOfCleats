export const applyTestEnv = ({ cacheRoot, embeddings } = {}) => {
  process.env.PAIROFCLEATS_TESTING = '1';
  if (cacheRoot) process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
  if (embeddings) process.env.PAIROFCLEATS_EMBEDDINGS = embeddings;
};
