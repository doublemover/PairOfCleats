import fsSync from 'node:fs';
import path from 'node:path';
import { getGitMetaForFile, getRepoProvenance as getLegacyRepoProvenance } from '../../git.js';
import { toPosix } from '../../../shared/files.js';
import { runScmCommand } from '../runner.js';
import { toRepoPosixPath } from '../paths.js';

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
    const result = await runScmCommand('git', args, {
      outputMode: 'string',
      captureStdout: true,
      captureStderr: true,
      rejectOnNonZeroExit: false
    });
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
    const result = await runScmCommand('git', args, {
      outputMode: 'string',
      captureStdout: true,
      captureStderr: true,
      rejectOnNonZeroExit: false
    });
    if (result.exitCode !== 0) {
      return { ok: false, reason: 'unavailable' };
    }
    const entries = ensurePosixList(parseLines(result.stdout))
      .map((entry) => toRepoPosixPath(entry, repoRoot))
      .filter(Boolean)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return { filesPosix: entries };
  },
  async getFileMeta({ repoRoot, filePosix }) {
    const absPath = path.join(repoRoot, filePosix);
    const meta = await getGitMetaForFile(absPath, { blame: false, baseDir: repoRoot });
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
  async annotate({ repoRoot, filePosix, timeoutMs }) {
    const absPath = path.join(repoRoot, filePosix);
    const meta = await getGitMetaForFile(absPath, { blame: true, baseDir: repoRoot });
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
  let current = path.resolve(startPath || process.cwd());
  while (true) {
    const gitPath = path.join(current, '.git');
    if (fsExists(gitPath)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
};

const fsExists = (value) => {
  try {
    return Boolean(value) && fsSync.existsSync(value);
  } catch {
    return false;
  }
};
