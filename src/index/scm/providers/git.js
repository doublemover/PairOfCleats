import fsSync from 'node:fs';
import path from 'node:path';
import {
  getGitLineAuthorsForFile,
  getGitMetaForFile,
  getRepoProvenance
} from '../../git.js';
import { toPosix } from '../../../shared/file-paths.js';
import { findUpwards } from '../../../shared/fs/find-upwards.js';
import { runScmCommand } from '../runner.js';
import { inspectScmFileInventory, unavailableScmFileInventory } from '../file-inventory.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { toRepoPosixPath } from '../paths.js';
import { buildScmFreshnessGuard } from '../runtime.js';
import { preserveScmMetadataFailure } from '../metadata-diagnostics.js';
import { resolveGitConfig, runGitTask } from './git/config.js';
import {
  buildGitMetaBatchResponseFromEntry,
  createGitMetaPrefetchEntry,
  createUnavailableFileMeta,
  getGitMetaPrefetchEntry,
  mergeGitMetaPrefetchEntry,
  readGitMetaPrefetchValue,
  runGitMetaPrefetchTask,
  setGitMetaPrefetchEntry,
  toUniquePosixFiles,
  upsertGitMetaPrefetch
} from './git/prefetch.js';
import {
  createBatchDiagnostics,
  getGitMetaTimeoutState,
  runGitMetaBatchFetch
} from './git/meta-batch.js';

const SCM_STRING_COMMAND_OPTIONS = Object.freeze({
  outputMode: 'string',
  captureStdout: true,
  captureStderr: true,
  rejectOnNonZeroExit: false
});

/**
 * Stable lexical comparator used for deterministic file ordering.
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
const compareLexicographically = (left, right) => (
  left < right ? -1 : left > right ? 1 : 0
);

/**
 * Parse NUL-delimited `git -z` output.
 * @param {string} value
 * @returns {string[]}
 */
const parseNullSeparated = (value) => (
  String(value || '')
    .split('\0')
    .filter(Boolean)
);

/**
 * Normalize SCM paths to repo-relative posix and return sorted output.
 * @param {string[]} entries
 * @param {string} repoRoot
 * @returns {string[]}
 */
const toSortedRepoPosixFiles = (entries, repoRoot) => {
  const filesPosix = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    // Git -z labels already use forward slash separators. On POSIX a literal
    // backslash is filename data, not a separator to rewrite.
    const relative = path.relative(path.resolve(repoRoot), path.resolve(repoRoot, entry));
    const normalized = process.platform === 'win32' ? relative.replaceAll('\\', '/') : relative;
    if (normalized === '..' || normalized.startsWith('../') || path.isAbsolute(normalized)) continue;
    if (!normalized) continue;
    filesPosix.push(normalized);
  }
  filesPosix.sort(compareLexicographically);
  return filesPosix;
};

/**
 * Standard provider unavailable payload.
 * @returns {{ok:false,reason:'unavailable'}}
 */
const toUnavailableResult = (result = null) => ({ ok: false, reason: 'unavailable', ...preserveScmMetadataFailure(result) });

/**
 * Run a git task with shared timeout/circuit state.
 * @param {() => Promise<any>} task
 * @param {object} [options]
 * @returns {Promise<any>}
 */
const runGitProviderTask = (task, options = {}) => runGitTask(task, {
  ...options,
  timeoutState: getGitMetaTimeoutState()
});

/**
 * Execute a git command through the SCM runner in non-throwing mode.
 * @param {string[]} args
 * @returns {Promise<{exitCode:number,stdout:string,stderr:string}>}
 */
const runGitProviderCommand = (args, signal = null) => runGitProviderTask(() => {
  throwIfAborted(signal);
  return runScmCommand('git', args, { ...SCM_STRING_COMMAND_OPTIONS, signal });
});

/**
 * Build freshness guard key used for metadata prefetch cache scoping.
 * @param {{repoRoot:string,headId?:string|null}} input
 * @returns {object}
 */
const buildGitFreshnessGuard = ({ repoRoot, headId = null, includeChurn = false }) => buildScmFreshnessGuard({
  provider: 'git',
  repoRoot,
  repoHeadId: headId,
  includeChurn
});

/**
 * Append repo-scoped path filter argument (`-- <subdir>`) when provided.
 * @param {string[]} args
 * @param {{repoRoot:string,subdir?:string|null}} input
 * @returns {string[]}
 */
const appendScopedSubdirArg = (args, { repoRoot, subdir = null }) => {
  const scoped = subdir ? toRepoPosixPath(subdir, repoRoot) : null;
  if (scoped) args.push('--', scoped);
  return args;
};

/**
 * Append optional diff ref range arguments.
 * @param {string[]} args
 * @param {{fromRef?:string|null,toRef?:string|null}} input
 * @returns {string[]}
 */
const appendDiffRefArgs = (args, { fromRef = null, toRef = null }) => {
  if (fromRef && toRef) {
    args.push(fromRef, toRef);
  } else if (fromRef) {
    args.push(fromRef);
  } else if (toRef) {
    args.push(toRef);
  }
  return args;
};

/**
 * Parse command stdout into normalized file list.
 * @param {{stdout:string,repoRoot:string,parser:(value:string)=>string[]}} input
 * @returns {string[]}
 */
export const parseProviderFileList = ({ stdout, repoRoot, parser }) => (
  toSortedRepoPosixFiles(parser(stdout), repoRoot)
);

/**
 * Normalize git metadata payload fields to provider contract names.
 * @param {object} meta
 * @returns {object}
 */
const normalizeSingleFileMeta = (meta) => ({
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
const upsertSingleFileMetaPrefetch = ({ freshnessGuard, config, filePosix, meta }) => {
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
const getPrefetchMissingFiles = (entry, filesPosix) => (
  entry?.knownFiles
    ? filesPosix.filter((filePosix) => !entry.knownFiles.has(filePosix))
    : filesPosix
);

/**
 * Fetch batched git metadata with timeout-aware task wrapper.
 * @param {object} input
 * @returns {Promise<object|null>}
 */
const fetchGitMetaBatch = async ({
  repoRoot,
  filesPosix,
  timeoutMs,
  config,
  includeChurn = false
}) => {
  const fetched = await runGitMetaBatchFetch({
    repoRoot,
    filesPosix,
    timeoutMs,
    config,
    includeChurn
  });
  return fetched;
};

/**
 * Shape successful fetch response to provider return contract.
 * @param {object} fetched
 * @returns {{fileMetaByPath:object,diagnostics:object|null}}
 */
const buildFetchedBatchResponse = (fetched) => ({
  fileMetaByPath: fetched.fileMetaByPath,
  diagnostics: fetched.diagnostics || null
});

const GIT_METADATA_CAPABILITIES = Object.freeze({
  author: true,
  time: true,
  branch: true,
  churn: true,
  commitId: true,
  changeId: false,
  operationId: false,
  bookmarks: false,
  annotateCommitId: false
});

/**
 * Git-backed SCM provider implementation used by indexing and tooling stages.
 *
 * Fallback semantics:
 * 1. Non-zero git commands return `{ ok:false, reason:'unavailable' }`.
 * 2. Metadata calls consult freshness-scoped prefetch cache first.
 * 3. Batch hydration degrades to unavailable when fetch fails/timeouts.
 */
export const gitProvider = {
  name: 'git',
  adapter: 'parity',
  metadataCapabilities: GIT_METADATA_CAPABILITIES,
  detect({ startPath }) {
    const repoRoot = findGitRoot(startPath || process.cwd());
    return repoRoot ? { ok: true, provider: 'git', repoRoot, detectedBy: 'git-root' } : { ok: false };
  },
  async listTrackedFiles({ repoRoot, subdir = null, signal = null }) {
    const args = appendScopedSubdirArg(['-C', repoRoot, 'ls-files', '-z'], { repoRoot, subdir });
    const result = await runGitProviderCommand(args, signal);
    throwIfAborted(signal);
    const inventory = inspectScmFileInventory(result, { provider: 'git', operation: 'tracked' });
    if (!inventory.complete) return unavailableScmFileInventory(inventory);
    return {
      complete: true, inventory,
      filesPosix: parseProviderFileList({
        stdout: result.stdout,
        repoRoot,
        parser: parseNullSeparated
      })
    };
  },
  async getRepoProvenance({ repoRoot }) {
    const repoProvenance = await getRepoProvenance(repoRoot);
    const commitId = repoProvenance?.commit || null;
    const branch = repoProvenance?.branch || null;
    return {
      provider: 'git',
      root: repoRoot,
      head: {
        commitId,
        branch
      },
      dirty: repoProvenance?.dirty ?? null,
      detectedBy: 'git-root',
      commit: commitId,
      branch,
      isRepo: repoProvenance?.isRepo ?? null
    };
  },
  async getChangedFiles({ repoRoot, fromRef = null, toRef = null, subdir = null, signal = null }) {
    const args = appendScopedSubdirArg(
      appendDiffRefArgs(['-C', repoRoot, 'diff', '--name-only', '-z'], { fromRef, toRef }),
      { repoRoot, subdir }
    );
    const result = await runGitProviderCommand(args, signal);
    throwIfAborted(signal);
    const inventory = inspectScmFileInventory(result, { provider: 'git', operation: 'changed' });
    if (!inventory.complete) return unavailableScmFileInventory(inventory);
    return {
      complete: true, inventory,
      filesPosix: parseProviderFileList({
        stdout: result.stdout,
        repoRoot,
        parser: parseNullSeparated
      })
    };
  },
  async getHistoryAffectedFiles({ repoRoot, fromRef = null, toRef = null, subdir = null, signal = null }) {
    throwIfAborted(signal);
    // Endpoint tree equality cannot certify last-author/commit/churn equality.
    // Require an ancestry move and enumerate every path touched along it. A
    // rewritten history deliberately invalidates the whole metadata snapshot.
    if (!fromRef || !toRef || String(fromRef).startsWith('-') || String(toRef).startsWith('-')) return toUnavailableResult();
    const ancestry = await runGitProviderCommand(['-C', repoRoot, 'merge-base', '--is-ancestor', fromRef, toRef], signal);
    throwIfAborted(signal);
    if (ancestry.exitCode !== 0) return toUnavailableResult();
    const args = appendScopedSubdirArg(['-C', repoRoot, 'log', '--format=', '--name-only', '-z',
      '--no-renames', '-m', `${fromRef}..${toRef}`], { repoRoot, subdir });
    const result = await runGitProviderCommand(args, signal);
    throwIfAborted(signal);
    const inventory = inspectScmFileInventory(result, { provider: 'git', operation: 'history' });
    if (!inventory.complete) return unavailableScmFileInventory(inventory);
    return { complete: true, inventory, filesPosix: parseProviderFileList({ stdout: result.stdout,
      repoRoot, parser: parseNullSeparated }) };
  },
  async getFileMeta({ repoRoot, filePosix, timeoutMs, includeChurn = true, headId = null }) {
    const config = resolveGitConfig({ timeoutState: getGitMetaTimeoutState() });
    const normalizedFilePosix = toRepoPosixPath(filePosix, repoRoot);
    if (!normalizedFilePosix) {
      return toUnavailableResult();
    }
    const freshnessGuard = buildGitFreshnessGuard({ repoRoot, headId, includeChurn });
    const cachedMeta = readGitMetaPrefetchValue({
      freshnessGuard,
      config,
      filePosix: normalizedFilePosix
    });
    if (cachedMeta) {
      return cachedMeta;
    }
    const absPath = path.join(repoRoot, normalizedFilePosix);
    const meta = await runGitProviderTask(() => getGitMetaForFile(absPath, {
      blame: false,
      baseDir: repoRoot,
      timeoutMs,
      includeChurn
    }));
    if (!meta || !meta.last_modified) {
      upsertSingleFileMetaPrefetch({
        freshnessGuard,
        config,
        filePosix: normalizedFilePosix,
        meta: createUnavailableFileMeta()
      });
      return toUnavailableResult();
    }
    const normalizedMeta = normalizeSingleFileMeta(meta);
    upsertSingleFileMetaPrefetch({
      freshnessGuard,
      config,
      filePosix: normalizedFilePosix,
      meta: normalizedMeta
    });
    return normalizedMeta;
  },
  async getFileMetaBatch({ repoRoot, filesPosix, timeoutMs, includeChurn = false, headId = null }) {
    const config = resolveGitConfig({ timeoutState: getGitMetaTimeoutState() });
    const normalizedFiles = toUniquePosixFiles(filesPosix, repoRoot);
    if (!normalizedFiles.length) {
      return { fileMetaByPath: Object.create(null) };
    }
    const freshnessGuard = buildGitFreshnessGuard({ repoRoot, headId, includeChurn });
    const canUsePrefetchCache = Boolean(freshnessGuard.key && config.prefetchCacheMaxEntries > 0);
    if (canUsePrefetchCache) {
      const cachedEntry = getGitMetaPrefetchEntry(freshnessGuard, config);
      const missing = getPrefetchMissingFiles(cachedEntry, normalizedFiles);
      if (!missing.length) {
        return buildGitMetaBatchResponseFromEntry({ entry: cachedEntry, filesPosix: normalizedFiles });
      }
      const hydratedResult = await runGitMetaPrefetchTask(freshnessGuard, async () => {
        const reusableEntry = getGitMetaPrefetchEntry(freshnessGuard, config)
          || createGitMetaPrefetchEntry(freshnessGuard);
        const unresolvedFiles = getPrefetchMissingFiles(reusableEntry, normalizedFiles);
        if (!unresolvedFiles.length) {
          return {
            entry: reusableEntry,
            diagnostics: createBatchDiagnostics()
          };
        }
        const fetched = await fetchGitMetaBatch({
          repoRoot,
          filesPosix: unresolvedFiles,
          timeoutMs,
          config,
          includeChurn
        });
        if (!fetched || fetched.ok === false) return { ...toUnavailableResult(fetched) };
        mergeGitMetaPrefetchEntry({
          entry: reusableEntry,
          filesPosix: unresolvedFiles,
          fileMetaByPath: fetched.fileMetaByPath
        });
        setGitMetaPrefetchEntry(freshnessGuard, reusableEntry, config);
        return {
          entry: reusableEntry,
          diagnostics: fetched.diagnostics || createBatchDiagnostics()
        };
      });
      if (!hydratedResult?.entry) {
        return toUnavailableResult(hydratedResult);
      }
      return buildGitMetaBatchResponseFromEntry({
        entry: hydratedResult.entry,
        filesPosix: normalizedFiles,
        diagnostics: hydratedResult.diagnostics || null
      });
    }
    const fetched = await fetchGitMetaBatch({
      repoRoot,
      filesPosix: normalizedFiles,
      timeoutMs,
      config,
      includeChurn
    });
    if (!fetched || fetched.ok === false) return toUnavailableResult(fetched);
    return buildFetchedBatchResponse(fetched);
  },
  async annotate({ repoRoot, filePosix, timeoutMs, signal, commitId = null }) {
    const absPath = path.join(repoRoot, filePosix);
    const lineAuthors = await runGitProviderTask(() => getGitLineAuthorsForFile(absPath, {
      baseDir: repoRoot,
      timeoutMs,
      signal,
      commitId
    }));
    if (!Array.isArray(lineAuthors)) {
      return { ok: false, reason: 'unavailable' };
    }
    const lines = lineAuthors.map((author, index) => ({
      line: index + 1,
      author: author || 'unknown'
    }));
    return { lines };
  }
};

/**
 * Discover the nearest git root by searching upward for `.git`.
 * @param {string} startPath
 * @returns {string|null}
 */
const findGitRoot = (startPath) => {
  return findUpwards(
    startPath || process.cwd(),
    (candidateDir) => fsExists(path.join(candidateDir, '.git'))
  );
};

/**
 * Guarded filesystem existence check.
 * @param {string} value
 * @returns {boolean}
 */
const fsExists = (value) => {
  try {
    return Boolean(value) && fsSync.existsSync(value);
  } catch {
    return false;
  }
};
