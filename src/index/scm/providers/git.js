import fsSync from 'node:fs';
import path from 'node:path';
import PQueue from 'p-queue';
import {
  getGitLineAuthorsForFile,
  getGitMetaForFile,
  getRepoProvenance as getLegacyRepoProvenance
} from '../../git.js';
import { toPosix } from '../../../shared/files.js';
import { findUpwards } from '../../../shared/fs/find-upwards.js';
import { runScmCommand } from '../runner.js';
import { toRepoPosixPath } from '../paths.js';
import { getScmRuntimeConfig } from '../runtime.js';
import { showProgress } from '../../../shared/progress.js';

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

const GIT_META_BATCH_FORMAT_PREFIX = '__POC_GIT_META__';
const GIT_META_BATCH_CHUNK_SIZE = 96;
const GIT_META_BATCH_SMALL_REPO_CHUNK_MAX = 2;

const toPositiveIntOrNull = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.max(1, Math.floor(numeric));
};

const toUniquePosixFiles = (filesPosix = [], repoRoot = null) => {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(filesPosix) ? filesPosix : []) {
    const normalized = repoRoot
      ? toRepoPosixPath(raw, repoRoot)
      : toPosix(String(raw || ''));
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

const chunkList = (items, size) => {
  const chunkSize = Number.isFinite(Number(size)) && Number(size) > 0
    ? Math.max(1, Math.floor(Number(size)))
    : 1;
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
};

const runWithBoundedConcurrency = async (items, concurrency, worker) => {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const resolvedConcurrency = Number.isFinite(Number(concurrency)) && Number(concurrency) > 0
    ? Math.max(1, Math.floor(Number(concurrency)))
    : 1;
  const maxWorkers = Math.min(list.length, resolvedConcurrency);
  const out = new Array(list.length);
  let cursor = 0;
  const runWorker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      out[index] = await worker(list[index], index);
    }
  };
  await Promise.all(Array.from({ length: maxWorkers }, () => runWorker()));
  return out;
};

const parseGitMetaBatchOutput = ({ stdout, repoRoot }) => {
  const fileMetaByPath = Object.create(null);
  let currentMeta = null;
  for (const row of String(stdout || '').split(/\r?\n/)) {
    const line = String(row || '').trim();
    if (!line) continue;
    if (line.startsWith(GIT_META_BATCH_FORMAT_PREFIX)) {
      const payload = line.slice(GIT_META_BATCH_FORMAT_PREFIX.length);
      const [lastModifiedAtRaw, ...authorParts] = payload.split('\0');
      const lastModifiedAt = String(lastModifiedAtRaw || '').trim() || null;
      const lastAuthor = authorParts.join('\0').trim() || null;
      currentMeta = { lastModifiedAt, lastAuthor };
      continue;
    }
    if (!currentMeta) continue;
    const fileKey = toRepoPosixPath(line, repoRoot);
    if (!fileKey || fileMetaByPath[fileKey]) continue;
    fileMetaByPath[fileKey] = {
      lastModifiedAt: currentMeta.lastModifiedAt,
      lastAuthor: currentMeta.lastAuthor,
      churn: null,
      churnAdded: null,
      churnDeleted: null,
      churnCommits: null
    };
  }
  return fileMetaByPath;
};

let gitQueue = null;
let gitQueueConcurrency = null;

const resolveGitConfig = () => {
  const config = getScmRuntimeConfig() || {};
  const runtimeConfig = config.runtime && typeof config.runtime === 'object'
    ? config.runtime
    : {};
  const runtimeThreadFloor = Math.max(
    toPositiveIntOrNull(runtimeConfig.fileConcurrency) || 1,
    toPositiveIntOrNull(runtimeConfig.cpuConcurrency) || 1
  );
  const maxConcurrentProcesses = Number.isFinite(Number(config.maxConcurrentProcesses))
    ? Math.max(1, Math.floor(Number(config.maxConcurrentProcesses)))
    : (runtimeThreadFloor > 1 ? runtimeThreadFloor : 8);
  const gitMetaBatchConfig = config.gitMetaBatch && typeof config.gitMetaBatch === 'object'
    ? config.gitMetaBatch
    : {};
  const smallRepoChunkMax = Number.isFinite(Number(gitMetaBatchConfig.smallRepoChunkMax))
    ? Math.max(1, Math.floor(Number(gitMetaBatchConfig.smallRepoChunkMax)))
    : GIT_META_BATCH_SMALL_REPO_CHUNK_MAX;
  const minParallelChunks = Number.isFinite(Number(gitMetaBatchConfig.minParallelChunks))
    ? Math.max(1, Math.floor(Number(gitMetaBatchConfig.minParallelChunks)))
    : runtimeThreadFloor;
  return {
    maxConcurrentProcesses,
    smallRepoChunkMax,
    minParallelChunks
  };
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
  async getFileMetaBatch({ repoRoot, filesPosix, timeoutMs }) {
    const config = resolveGitConfig();
    const normalizedFiles = toUniquePosixFiles(filesPosix, repoRoot);
    if (!normalizedFiles.length) {
      return { fileMetaByPath: Object.create(null) };
    }
    const fileMetaByPath = Object.create(null);
    const chunks = chunkList(normalizedFiles, GIT_META_BATCH_CHUNK_SIZE);
    const resolvedTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
      ? Math.max(5000, Math.floor(Number(timeoutMs)))
      : 15000;
    const forceSequential = chunks.length <= config.smallRepoChunkMax;
    const batchConcurrency = forceSequential
      ? 1
      : Math.max(
        1,
        Math.min(
          chunks.length,
          Math.max(config.maxConcurrentProcesses, config.minParallelChunks)
        )
      );
    const shouldEmitProgress = chunks.length > 1;
    const baseProgressMeta = {
      taskId: 'scm:git:file-meta-batch',
      stage: 'scm',
      mode: 'git-file-meta',
      unit: 'chunks',
      ephemeral: true
    };
    if (shouldEmitProgress) {
      showProgress('SCM Git Meta', 0, chunks.length, {
        ...baseProgressMeta,
        message: `chunks 0/${chunks.length} | concurrency ${batchConcurrency}`
      });
    }
    let completedChunks = 0;
    const chunkResults = await runWithBoundedConcurrency(chunks, batchConcurrency, async (chunk) => {
      const args = [
        '-C',
        repoRoot,
        'log',
        '--date=iso-strict',
        `--format=${GIT_META_BATCH_FORMAT_PREFIX}%aI%x00%an`,
        '--name-only',
        '--',
        ...chunk
      ];
      const result = await runGitTask(() => runScmCommand('git', args, {
        outputMode: 'string',
        captureStdout: true,
        captureStderr: true,
        rejectOnNonZeroExit: false,
        timeoutMs: resolvedTimeoutMs
      }), { useQueue: config.maxConcurrentProcesses > 1 });
      if (result.exitCode !== 0) {
        return { ok: false, reason: 'unavailable' };
      }
      completedChunks += 1;
      if (shouldEmitProgress) {
        showProgress('SCM Git Meta', completedChunks, chunks.length, {
          ...baseProgressMeta,
          message: `chunks ${completedChunks}/${chunks.length} | concurrency ${batchConcurrency}`
        });
      }
      return {
        ok: true,
        fileMetaByPath: parseGitMetaBatchOutput({ stdout: result.stdout, repoRoot })
      };
    });
    for (const chunkResult of chunkResults) {
      if (!chunkResult?.ok) {
        return { ok: false, reason: 'unavailable' };
      }
      const chunkMeta = chunkResult.fileMetaByPath || {};
      for (const [fileKey, meta] of Object.entries(chunkMeta)) {
        if (!fileKey || fileMetaByPath[fileKey]) continue;
        fileMetaByPath[fileKey] = meta;
      }
    }
    return { fileMetaByPath };
  },
  async annotate({ repoRoot, filePosix, timeoutMs, signal }) {
    const absPath = path.join(repoRoot, filePosix);
    const lineAuthors = await runGitTask(() => getGitLineAuthorsForFile(absPath, {
      baseDir: repoRoot,
      timeoutMs,
      signal
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
