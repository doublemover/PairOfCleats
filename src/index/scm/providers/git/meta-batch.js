import { runWithConcurrency } from '../../../../shared/concurrency.js';
import { toPosix } from '../../../../shared/files.js';
import { showProgress } from '../../../../shared/progress.js';
import { toRepoPosixPath } from '../../paths.js';
import { runScmCommand } from '../../runner.js';
import { runGitTask } from './config.js';
import {
  chunkList,
  resolveGitMetaBatchChunkSize,
  resolveGitMetaBatchCommitLimit
} from './meta-batch-planning.js';
import {
  createUnavailableFileMeta,
  normalizeFileMeta,
  toUniquePosixFiles
} from './prefetch.js';
import { buildMetaPathScopeKey } from './path-normalization.js';
import {
  createGitMetaBatchFailure,
  resolveChunkCost,
  resolveTimeoutPlan
} from './timeout-policy.js';

const GIT_META_BATCH_FORMAT_PREFIX = '__POC_GIT_META__';

let gitMetaTimeoutState = new Map();

export const getGitMetaTimeoutState = () => gitMetaTimeoutState;

const parseGitMetaBatchOutput = ({ stdout, repoRoot }) => {
  const fileMetaByPath = Object.create(null);
  let currentMeta = null;
  for (const row of String(stdout || '').split(/\r?\n/)) {
    const line = String(row || '').trim();
    if (!line) continue;
    if (line.startsWith(GIT_META_BATCH_FORMAT_PREFIX)) {
      const payload = line.slice(GIT_META_BATCH_FORMAT_PREFIX.length);
      const parts = payload.split('\0');
      const hasCommitPrefix = parts.length >= 3 && /^[0-9a-f]{7,64}$/i.test(String(parts[0] || '').trim());
      const lastCommitIdRaw = hasCommitPrefix ? parts[0] : null;
      const lastModifiedAtRaw = hasCommitPrefix ? parts[1] : parts[0];
      const authorParts = hasCommitPrefix ? parts.slice(2) : parts.slice(1);
      const lastCommitId = String(lastCommitIdRaw || '').trim().toLowerCase() || null;
      const lastModifiedAt = String(lastModifiedAtRaw || '').trim() || null;
      const lastAuthor = authorParts.join('\0').trim() || null;
      currentMeta = { lastCommitId, lastModifiedAt, lastAuthor };
      continue;
    }
    if (!currentMeta) continue;
    const fileKey = toRepoPosixPath(line, repoRoot);
    if (!fileKey || fileMetaByPath[fileKey]) continue;
    fileMetaByPath[fileKey] = {
      lastCommitId: currentMeta.lastCommitId,
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


export const createBatchDiagnostics = () => ({
  timeoutCount: 0,
  timeoutRetries: 0,
  cooldownSkips: 0,
  unavailableChunks: 0,
  timeoutHeatmap: []
});

const registerHeatEntry = (heatByPath, filePosix, patch = {}) => {
  const key = toPosix(filePosix);
  if (!key) return;
  const entry = heatByPath.get(key) || {
    file: key,
    timeouts: 0,
    retries: 0,
    cooldownSkips: 0,
    lastTimeoutMs: null
  };
  if (patch.timeout === true) {
    entry.timeouts += 1;
    if (Number.isFinite(Number(patch.timeoutMs)) && Number(patch.timeoutMs) > 0) {
      entry.lastTimeoutMs = Math.floor(Number(patch.timeoutMs));
    }
  }
  if (patch.retry === true) entry.retries += 1;
  if (patch.cooldownSkip === true) entry.cooldownSkips += 1;
  heatByPath.set(key, entry);
};

export const runGitMetaBatchFetch = async ({ repoRoot, filesPosix, timeoutMs, config }) => {
  const normalizedFiles = toUniquePosixFiles(filesPosix, repoRoot);
  const diagnostics = createBatchDiagnostics();
  if (!normalizedFiles.length) {
    return {
      ok: true,
      fileMetaByPath: Object.create(null),
      diagnostics
    };
  }
  const timeoutPolicy = config.timeoutPolicy || {};
  const fileMetaByPath = Object.create(null);
  const heatByPath = new Map();
  const now = Date.now();
  const activeFiles = [];
  for (const filePosix of normalizedFiles) {
    const pathKey = buildMetaPathScopeKey(repoRoot, filePosix);
    const bucket = gitMetaTimeoutState.get(pathKey);
    const blockedUntil = Number(bucket?.blockedUntil) || 0;
    if (blockedUntil > now) {
      fileMetaByPath[filePosix] = createUnavailableFileMeta();
      diagnostics.cooldownSkips += 1;
      registerHeatEntry(heatByPath, filePosix, { cooldownSkip: true });
      continue;
    }
    if (bucket && blockedUntil > 0 && blockedUntil <= now) {
      gitMetaTimeoutState.delete(pathKey);
    }
    activeFiles.push(filePosix);
  }

  const markTimeout = (filePosix, timeoutMsForAttempt = null) => {
    const key = buildMetaPathScopeKey(repoRoot, filePosix);
    const existing = gitMetaTimeoutState.get(key) || {
      timeouts: 0,
      blockedUntil: 0,
      updatedAt: 0
    };
    const timeoutCount = Math.max(0, existing.timeouts) + 1;
    const blockedUntil = timeoutCount >= timeoutPolicy.cooldownAfterTimeouts
      ? Date.now() + timeoutPolicy.cooldownMs
      : 0;
    gitMetaTimeoutState.set(key, {
      ...existing,
      timeouts: timeoutCount,
      blockedUntil,
      updatedAt: Date.now()
    });
    registerHeatEntry(heatByPath, filePosix, {
      timeout: true,
      timeoutMs: timeoutMsForAttempt
    });
  };

  const clearTimeoutState = (filePosix) => {
    const key = buildMetaPathScopeKey(repoRoot, filePosix);
    gitMetaTimeoutState.delete(key);
  };

  if (!activeFiles.length) {
    diagnostics.timeoutHeatmap = Array.from(heatByPath.values());
    return {
      ok: true,
      fileMetaByPath,
      diagnostics
    };
  }

  const batchChunkSize = resolveGitMetaBatchChunkSize(activeFiles.length);
  const batchCommitLimit = resolveGitMetaBatchCommitLimit(
    activeFiles.length,
    config.maxCommitsPerChunk
  );
  const chunks = chunkList(activeFiles, batchChunkSize);
  const resolvedTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.max(timeoutPolicy.minTimeoutMs, Math.floor(Number(timeoutMs)))
    : 15000;
  const forceSequential = chunks.length <= config.smallRepoChunkMax;
  const batchConcurrencyCap = config.explicitMaxConcurrentProcesses
    ? config.maxConcurrentProcesses
    : Math.max(config.maxConcurrentProcesses, config.minParallelChunks);
  const batchConcurrency = forceSequential
    ? 1
    : Math.max(
      1,
      Math.min(
        chunks.length,
        batchConcurrencyCap
      )
    );
  const shouldEmitProgress = chunks.length > 1;
  const baseProgressMeta = {
    taskId: 'scm:git:file-meta-batch',
    stage: 'scm',
    unit: 'chunks',
    ephemeral: true
  };
  if (shouldEmitProgress) {
    showProgress('SCM Meta', 0, chunks.length, baseProgressMeta);
  }

  let completedChunks = 0;
  const chunkResults = await runWithConcurrency(chunks, batchConcurrency, async (chunk) => {
    try {
      const chunkCost = resolveChunkCost({
        repoRoot,
        chunk,
        timeoutState: gitMetaTimeoutState
      });
      const timeoutPlan = resolveTimeoutPlan({
        baseTimeoutMs: resolvedTimeoutMs,
        timeoutPolicy,
        chunkCost
      });
      let parsedMetaByPath = null;
      let failure = null;
      for (let attemptIndex = 0; attemptIndex < timeoutPlan.length; attemptIndex += 1) {
        const attemptTimeoutMs = timeoutPlan[attemptIndex];
        const args = [
          '-C',
          repoRoot,
          'log',
          '--date=iso-strict',
          `--format=${GIT_META_BATCH_FORMAT_PREFIX}%H%x00%aI%x00%an`,
          '--name-only'
        ];
        if (batchCommitLimit > 0) {
          args.push('-n', String(batchCommitLimit));
        }
        args.push('--', ...chunk);
        let result = null;
        try {
          result = await runGitTask(() => runScmCommand('git', args, {
            outputMode: 'string',
            captureStdout: true,
            captureStderr: true,
            rejectOnNonZeroExit: false,
            timeoutMs: attemptTimeoutMs
          }), {
            useQueue: config.maxConcurrentProcesses > 1,
            timeoutState: gitMetaTimeoutState
          });
        } catch (err) {
          failure = createGitMetaBatchFailure({ err });
          if (failure.timeoutLike) {
            diagnostics.timeoutCount += 1;
            for (const filePosix of chunk) {
              markTimeout(filePosix, attemptTimeoutMs);
            }
          }
          const canRetry = failure.timeoutLike && attemptIndex < timeoutPlan.length - 1;
          if (canRetry) {
            diagnostics.timeoutRetries += 1;
            for (const filePosix of chunk) {
              registerHeatEntry(heatByPath, filePosix, { retry: true });
            }
            continue;
          }
          break;
        }
        if (result?.exitCode === 0) {
          parsedMetaByPath = parseGitMetaBatchOutput({ stdout: result.stdout, repoRoot });
          for (const filePosix of chunk) {
            clearTimeoutState(filePosix);
          }
          failure = null;
          break;
        }
        failure = createGitMetaBatchFailure({ result });
        if (failure.timeoutLike) {
          diagnostics.timeoutCount += 1;
          for (const filePosix of chunk) {
            markTimeout(filePosix, attemptTimeoutMs);
          }
        }
        const canRetry = failure.timeoutLike && attemptIndex < timeoutPlan.length - 1;
        if (canRetry) {
          diagnostics.timeoutRetries += 1;
          for (const filePosix of chunk) {
            registerHeatEntry(heatByPath, filePosix, { retry: true });
          }
          continue;
        }
        break;
      }
      if (parsedMetaByPath) {
        for (const filePosix of chunk) {
          if (parsedMetaByPath[filePosix]) continue;
          parsedMetaByPath[filePosix] = createUnavailableFileMeta();
        }
        return { ok: true, fileMetaByPath: parsedMetaByPath };
      }
      diagnostics.unavailableChunks += 1;
      if (failure && (failure.fatalUnavailable || !failure.timeoutLike)) {
        return { ok: false, fatal: true, reason: failure.message || 'unavailable' };
      }
      const unavailableMetaByPath = Object.create(null);
      for (const filePosix of chunk) {
        unavailableMetaByPath[filePosix] = createUnavailableFileMeta();
      }
      return {
        ok: true,
        fileMetaByPath: unavailableMetaByPath
      };
    } finally {
      completedChunks += 1;
      if (shouldEmitProgress) {
        showProgress('SCM Meta', completedChunks, chunks.length, baseProgressMeta);
      }
    }
  });

  for (const chunkResult of Array.isArray(chunkResults) ? chunkResults : []) {
    if (chunkResult?.fatal) {
      return {
        ok: false,
        reason: 'unavailable',
        diagnostics
      };
    }
    if (!chunkResult?.ok) continue;
    const chunkMeta = chunkResult.fileMetaByPath || {};
    for (const [fileKey, meta] of Object.entries(chunkMeta)) {
      if (!fileKey || fileMetaByPath[fileKey]) continue;
      fileMetaByPath[fileKey] = normalizeFileMeta(meta);
    }
  }
  for (const filePosix of normalizedFiles) {
    if (fileMetaByPath[filePosix]) continue;
    fileMetaByPath[filePosix] = createUnavailableFileMeta();
  }
  diagnostics.timeoutHeatmap = Array.from(heatByPath.values())
    .filter((entry) => (entry.timeouts > 0 || entry.cooldownSkips > 0))
    .sort((left, right) => (
      (right.timeouts - left.timeouts)
      || (right.cooldownSkips - left.cooldownSkips)
      || left.file.localeCompare(right.file)
    ))
    .slice(0, timeoutPolicy.heatmapMaxEntries);
  if (diagnostics.timeoutHeatmap.length) {
    const heatLabel = diagnostics.timeoutHeatmap
      .slice(0, 3)
      .map((entry) => `${entry.file}:${entry.timeouts}t/${entry.cooldownSkips}c`)
      .join(', ');
    showProgress(
      'SCM Meta',
      shouldEmitProgress ? chunks.length : 1,
      shouldEmitProgress ? chunks.length : 1,
      {
        ...baseProgressMeta,
        message: `timeouts=${diagnostics.timeoutCount} retries=${diagnostics.timeoutRetries} cooldownSkips=${diagnostics.cooldownSkips} heatmap=${heatLabel}`
      }
    );
  }
  return {
    ok: true,
    fileMetaByPath,
    diagnostics
  };
};
