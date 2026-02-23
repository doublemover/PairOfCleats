const GIT_META_BATCH_CHUNK_SIZE = 96;
const GIT_META_BATCH_CHUNK_SIZE_LARGE = 48;
const GIT_META_BATCH_CHUNK_SIZE_HUGE = 16;
const GIT_META_BATCH_FILESET_LARGE_MIN = 4000;
const GIT_META_BATCH_FILESET_HUGE_MIN = 8000;
const GIT_META_BATCH_COMMIT_LIMIT_DEFAULT = 2000;
const GIT_META_BATCH_COMMIT_LIMIT_HUGE_DEFAULT = 1000;

export const chunkList = (items, size) => {
  const chunkSize = Number.isFinite(Number(size)) && Number(size) > 0
    ? Math.max(1, Math.floor(Number(size)))
    : 1;
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
};

export const resolveGitMetaBatchChunkSize = (fileCount) => {
  const totalFiles = Number.isFinite(Number(fileCount))
    ? Math.max(0, Math.floor(Number(fileCount)))
    : 0;
  if (totalFiles >= GIT_META_BATCH_FILESET_HUGE_MIN) {
    return GIT_META_BATCH_CHUNK_SIZE_HUGE;
  }
  if (totalFiles >= GIT_META_BATCH_FILESET_LARGE_MIN) {
    return GIT_META_BATCH_CHUNK_SIZE_LARGE;
  }
  return GIT_META_BATCH_CHUNK_SIZE;
};

export const resolveGitMetaBatchCommitLimit = (fileCount, configuredLimit = null) => {
  const hasConfiguredLimit = configuredLimit !== null && configuredLimit !== undefined;
  if (hasConfiguredLimit && Number.isFinite(Number(configuredLimit))) {
    return Math.max(0, Math.floor(Number(configuredLimit)));
  }
  const totalFiles = Number.isFinite(Number(fileCount))
    ? Math.max(0, Math.floor(Number(fileCount)))
    : 0;
  if (totalFiles >= GIT_META_BATCH_FILESET_HUGE_MIN) {
    return GIT_META_BATCH_COMMIT_LIMIT_HUGE_DEFAULT;
  }
  return GIT_META_BATCH_COMMIT_LIMIT_DEFAULT;
};
