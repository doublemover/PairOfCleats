export const createUnavailableFileMeta = () => ({
  lastCommitId: null,
  lastModifiedAt: null,
  lastAuthor: null,
  churn: null,
  churnAdded: null,
  churnDeleted: null,
  churnCommits: null
});

const normalizeFiniteMetaNumber = (value) => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

export const normalizeFileMeta = (value) => ({
  lastCommitId: typeof value?.lastCommitId === 'string' ? value.lastCommitId : null,
  lastModifiedAt: typeof value?.lastModifiedAt === 'string' ? value.lastModifiedAt : null,
  lastAuthor: typeof value?.lastAuthor === 'string' ? value.lastAuthor : null,
  churn: normalizeFiniteMetaNumber(value?.churn),
  churnAdded: normalizeFiniteMetaNumber(value?.churnAdded),
  churnDeleted: normalizeFiniteMetaNumber(value?.churnDeleted),
  churnCommits: normalizeFiniteMetaNumber(value?.churnCommits)
});

export const hasFileMetaIdentity = (meta) => Boolean(
  meta
  && (
    typeof meta.lastCommitId === 'string'
    || typeof meta.lastModifiedAt === 'string'
    || typeof meta.lastAuthor === 'string'
  )
);

export const hasResolvedFileMetaChurn = (meta) => (
  (typeof meta?.churn === 'number' && Number.isFinite(meta.churn))
  || (typeof meta?.churnAdded === 'number' && Number.isFinite(meta.churnAdded))
  || (typeof meta?.churnDeleted === 'number' && Number.isFinite(meta.churnDeleted))
  || (typeof meta?.churnCommits === 'number' && Number.isFinite(meta.churnCommits))
);

export const isIncompleteFileMeta = (meta, { includeChurn = false } = {}) => {
  if (!hasFileMetaIdentity(meta)) return true;
  if (includeChurn !== true) return false;
  return !hasResolvedFileMetaChurn(meta);
};
