import fsSync from 'node:fs';
import path from 'node:path';
import PQueue from 'p-queue';
import { getGitMetaForFile, getRepoProvenance as getLegacyRepoProvenance } from '../../git.js';
import { toPosix } from '../../../shared/files.js';
import { findUpwards } from '../../../shared/fs/find-upwards.js';
import { runScmCommand } from '../runner.js';
import { toRepoPosixPath } from '../paths.js';
import { getScmRuntimeConfig } from '../runtime.js';

const parseNullSeparated = (value) => (
  String(value || '')
    .split('\0')
    .map((entry) => entry)
    .filter(Boolean)
);

const parseLines = (value) => (
  String(value || '')
    .split(/\r?\n/)
    .map((entry) => entry)
    .filter(Boolean)
);

const ensurePosixList = (entries) => (
  entries
    .map((entry) => toPosix(entry))
    .filter(Boolean)
);

let gitQueue = null;
let gitQueueConcurrency = null;

const resolveGitConfig = () => {
  const config = getScmRuntimeConfig() || {};
  const maxConcurrentProcesses = Number.isFinite(Number(config.maxConcurrentProcesses))
    ? Math.max(1, Math.floor(Number(config.maxConcurrentProcesses)))
    : 4;
  return { maxConcurrentProcesses };
};

const getQueue = (concurrency) => {
  if (!Number.isFinite(concurrency) || concurrency <= 0) return null;
  if (gitQueue && gitQueueConcurrency === concurrency) return gitQueue;
  gitQueueConcurrency = concurrency;
  gitQueue = new PQueue({ concurrency });
  return gitQueue;
};

const runGitTask = async (task, { useQueue = true } = {}) => {
  const config = resolveGitConfig();
  const queue = useQueue ? getQueue(config.maxConcurrentProcesses) : null;
  return queue ? queue.add(task) : task();
};

export const gitProvider = {
  name: 'git',
  detect({ startPath }) {
    const repoRoot = findGitRoot(startPath || process.cwd());
    return repoRoot ? { ok: true, provider: 'git', repoRoot, detectedBy: 'git-root' } : { ok: false };
  },
  async listTrackedFiles({ repoRoot, subdir = null }) {
    const args = ['-C', repoRoot, 'ls-files', '-z'];
    const scoped = subdir ? toRepoPosixPath(subdir, repoRoot) : null;
    if (scoped) args.push('--', scoped);
    const result = await runGitTask(() => runScmCommand('git', args, {
      outputMode: 'string',
      captureStdout: true,
      captureStderr: true,
      rejectOnNonZeroExit: false
    }));
    if (result.exitCode !== 0) {
      return { ok: false, reason: 'unavailable' };
    }
    const entries = ensurePosixList(parseNullSeparated(result.stdout))
      .map((entry) => toRepoPosixPath(entry, repoRoot))
      .filter(Boolean)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return { filesPosix: entries };
  },
  async getRepoProvenance({ repoRoot }) {
    const legacy = await getLegacyRepoProvenance(repoRoot);
    const commitId = legacy?.commit || null;
    const branch = legacy?.branch || null;
    return {
      provider: 'git',
      root: repoRoot,
      head: {
        commitId,
        branch
      },
      dirty: legacy?.dirty ?? null,
      detectedBy: 'git-root',
      commit: commitId,
      branch,
      isRepo: legacy?.isRepo ?? null
    };
  },
  async getChangedFiles({ repoRoot, fromRef = null, toRef = null, subdir = null }) {
    const args = ['-C', repoRoot, 'diff', '--name-only'];
    if (fromRef && toRef) {
      args.push(fromRef, toRef);
    } else if (fromRef) {
      args.push(fromRef);
    } else if (toRef) {
      args.push(toRef);
    }
    const scoped = subdir ? toRepoPosixPath(subdir, repoRoot) : null;
    if (scoped) args.push('--', scoped);
    const result = await runGitTask(() => runScmCommand('git', args, {
      outputMode: 'string',
      captureStdout: true,
      captureStderr: true,
      rejectOnNonZeroExit: false
    }));
    if (result.exitCode !== 0) {
      return { ok: false, reason: 'unavailable' };
    }
    const entries = ensurePosixList(parseLines(result.stdout))
      .map((entry) => toRepoPosixPath(entry, repoRoot))
      .filter(Boolean)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return { filesPosix: entries };
  },
  async getFileMeta({ repoRoot, filePosix, timeoutMs, includeChurn = true }) {
    const absPath = path.join(repoRoot, filePosix);
    const meta = await runGitTask(() => getGitMetaForFile(absPath, {
      blame: false,
      baseDir: repoRoot,
      timeoutMs,
      includeChurn
    }));
    if (!meta || !meta.last_modified) {
      return { ok: false, reason: 'unavailable' };
    }
    return {
      lastModifiedAt: meta.last_modified || null,
      lastAuthor: meta.last_author || null,
      churn: Number.isFinite(meta.churn) ? meta.churn : null,
      churnAdded: Number.isFinite(meta.churn_added) ? meta.churn_added : null,
      churnDeleted: Number.isFinite(meta.churn_deleted) ? meta.churn_deleted : null,
      churnCommits: Number.isFinite(meta.churn_commits) ? meta.churn_commits : null
    };
  },
  async annotate({ repoRoot, filePosix, timeoutMs, signal }) {
    const absPath = path.join(repoRoot, filePosix);
    const meta = await runGitTask(() => getGitMetaForFile(absPath, {
      blame: true,
      baseDir: repoRoot,
      timeoutMs,
      signal
    }));
    if (!meta || !Array.isArray(meta.lineAuthors)) {
      return { ok: false, reason: 'unavailable' };
    }
    const lines = meta.lineAuthors.map((author, index) => ({
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
