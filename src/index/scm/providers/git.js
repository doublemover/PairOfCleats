import fsSync from 'node:fs';
import path from 'node:path';
import {
  getGitLineAuthorsForFile,
  getGitMetaForFile,
  getRepoProvenance
} from '../../git.js';
import { toPosix } from '../../../shared/files.js';
import { findUpwards } from '../../../shared/fs/find-upwards.js';
import { runScmCommand } from '../runner.js';
import { toRepoPosixPath } from '../paths.js';
import { buildScmFreshnessGuard } from '../runtime.js';
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

const compareLexicographically = (left, right) => (
  left < right ? -1 : left > right ? 1 : 0
);

const parseNullSeparated = (value) => (
  String(value || '')
    .split('\0')
    .filter(Boolean)
);

const parseLines = (value) => (
  String(value || '')
    .split(/\r?\n/)
    .filter(Boolean)
);

const toSortedRepoPosixFiles = (entries, repoRoot) => {
  const filesPosix = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const normalized = toRepoPosixPath(toPosix(entry), repoRoot);
    if (!normalized) continue;
    filesPosix.push(normalized);
  }
  filesPosix.sort(compareLexicographically);
  return filesPosix;
};

const toUnavailableResult = () => ({ ok: false, reason: 'unavailable' });

const runGitProviderTask = (task, options = {}) => runGitTask(task, {
  ...options,
  timeoutState: getGitMetaTimeoutState()
});

const runGitProviderCommand = (args) => runGitProviderTask(() => runScmCommand('git', args, {
  ...SCM_STRING_COMMAND_OPTIONS
}));

const buildGitFreshnessGuard = ({ repoRoot, headId = null }) => buildScmFreshnessGuard({
  provider: 'git',
  repoRoot,
  repoHeadId: headId
});

const appendScopedSubdirArg = (args, { repoRoot, subdir = null }) => {
  const scoped = subdir ? toRepoPosixPath(subdir, repoRoot) : null;
  if (scoped) args.push('--', scoped);
  return args;
};

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

const parseProviderFileList = ({ stdout, repoRoot, parser }) => (
  toSortedRepoPosixFiles(parser(stdout), repoRoot)
);

const normalizeSingleFileMeta = (meta) => ({
  lastCommitId: typeof meta?.last_commit === 'string' ? meta.last_commit : null,
  lastModifiedAt: meta?.last_modified || null,
  lastAuthor: meta?.last_author || null,
  churn: Number.isFinite(meta?.churn) ? meta.churn : null,
  churnAdded: Number.isFinite(meta?.churn_added) ? meta.churn_added : null,
  churnDeleted: Number.isFinite(meta?.churn_deleted) ? meta.churn_deleted : null,
  churnCommits: Number.isFinite(meta?.churn_commits) ? meta.churn_commits : null
});

const upsertSingleFileMetaPrefetch = ({ freshnessGuard, config, filePosix, meta }) => {
  upsertGitMetaPrefetch({
    freshnessGuard,
    config,
    filesPosix: [filePosix],
    fileMetaByPath: { [filePosix]: meta }
  });
};

const getPrefetchMissingFiles = (entry, filesPosix) => (
  entry?.knownFiles
    ? filesPosix.filter((filePosix) => !entry.knownFiles.has(filePosix))
    : filesPosix
);

const fetchGitMetaBatch = async ({ repoRoot, filesPosix, timeoutMs, config }) => {
  const fetched = await runGitMetaBatchFetch({
    repoRoot,
    filesPosix,
    timeoutMs,
    config
  });
  return fetched.ok ? fetched : null;
};

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

export const gitProvider = {
  name: 'git',
  adapter: 'parity',
  metadataCapabilities: GIT_METADATA_CAPABILITIES,
  detect({ startPath }) {
    const repoRoot = findGitRoot(startPath || process.cwd());
    return repoRoot ? { ok: true, provider: 'git', repoRoot, detectedBy: 'git-root' } : { ok: false };
  },
  async listTrackedFiles({ repoRoot, subdir = null }) {
    const args = appendScopedSubdirArg(['-C', repoRoot, 'ls-files', '-z'], { repoRoot, subdir });
    const result = await runGitProviderCommand(args);
    if (result.exitCode !== 0) {
      return toUnavailableResult();
    }
    return {
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
  async getChangedFiles({ repoRoot, fromRef = null, toRef = null, subdir = null }) {
    const args = appendScopedSubdirArg(
      appendDiffRefArgs(['-C', repoRoot, 'diff', '--name-only'], { fromRef, toRef }),
      { repoRoot, subdir }
    );
    const result = await runGitProviderCommand(args);
    if (result.exitCode !== 0) {
      return toUnavailableResult();
    }
    return {
      filesPosix: parseProviderFileList({
        stdout: result.stdout,
        repoRoot,
        parser: parseLines
      })
    };
  },
  async getFileMeta({ repoRoot, filePosix, timeoutMs, includeChurn = true, headId = null }) {
    const config = resolveGitConfig({ timeoutState: getGitMetaTimeoutState() });
    const normalizedFilePosix = toRepoPosixPath(filePosix, repoRoot);
    if (!normalizedFilePosix) {
      return toUnavailableResult();
    }
    const freshnessGuard = buildGitFreshnessGuard({ repoRoot, headId });
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
    const freshnessGuard = buildGitFreshnessGuard({ repoRoot, headId });
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
          config
        });
        if (!fetched) return null;
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
        return toUnavailableResult();
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
      config
    });
    if (!fetched) return toUnavailableResult();
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

const findGitRoot = (startPath) => {
  return findUpwards(
    startPath || process.cwd(),
    (candidateDir) => fsExists(path.join(candidateDir, '.git'))
  );
};

const fsExists = (value) => {
  try {
    return Boolean(value) && fsSync.existsSync(value);
  } catch {
    return false;
  }
};
