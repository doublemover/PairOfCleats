import { runGitMetaBatchFetch } from './meta-batch.js';
import { upsertGitMetaPrefetch } from './prefetch.js';

/**
 * Standard provider unavailable payload.
 * @returns {{ok:false,reason:'unavailable'}}
 */
export const toUnavailableResult = () => ({ ok: false, reason: 'unavailable' });

/**
 * Normalize git metadata payload fields to provider contract names.
 * @param {object} meta
 * @returns {object}
 */
export const normalizeSingleFileMeta = (meta) => ({
  lastCommitId: typeof meta?.last_commit === 'string' ? meta.last_commit : null,
  lastModifiedAt: meta?.last_modified || null,
  lastAuthor: meta?.last_author || null,
  churn: Number.isFinite(meta?.churn) ? meta.churn : null,
  churnAdded: Number.isFinite(meta?.churn_added) ? meta.churn_added : null,
  churnDeleted: Number.isFinite(meta?.churn_deleted) ? meta.churn_deleted : null,
  churnCommits: Number.isFinite(meta?.churn_commits) ? meta.churn_commits : null
});

/**
 * Upsert one file's metadata into the prefetch cache.
 * @param {object} input
 * @returns {void}
 */
export const upsertSingleFileMetaPrefetch = ({ freshnessGuard, config, filePosix, meta }) => {
  upsertGitMetaPrefetch({
    freshnessGuard,
    config,
    filesPosix: [filePosix],
    fileMetaByPath: { [filePosix]: meta }
  });
};

/**
 * Determine which files still need hydration from git.
 * @param {object|null} entry
 * @param {string[]} filesPosix
 * @returns {string[]}
 */
export const getPrefetchMissingFiles = (entry, filesPosix) => (
  entry?.knownFiles
    ? filesPosix.filter((filePosix) => !entry.knownFiles.has(filePosix))
    : filesPosix
);

/**
 * Fetch batched git metadata with timeout-aware task wrapper.
 * @param {object} input
 * @returns {Promise<object|null>}
 */
export const fetchGitMetaBatch = async ({ repoRoot, filesPosix, timeoutMs, config }) => {
  const fetched = await runGitMetaBatchFetch({
    repoRoot,
    filesPosix,
    timeoutMs,
    config
  });
  return fetched.ok ? fetched : null;
};

/**
 * Shape successful fetch response to provider return contract.
 * @param {object} fetched
 * @returns {{fileMetaByPath:object,diagnostics:object|null}}
 */
export const buildFetchedBatchResponse = (fetched) => ({
  fileMetaByPath: fetched.fileMetaByPath,
  diagnostics: fetched.diagnostics || null
});
