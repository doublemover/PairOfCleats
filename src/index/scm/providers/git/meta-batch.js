import fsSync from 'node:fs';
import path from 'node:path';
import { runWithConcurrency } from '../../../../shared/concurrency/run-with-queue.js';
import { toPosix } from '../../../../shared/file-paths.js';
import { showProgress } from '../../../../shared/progress-runtime.js';
import { toRepoPosixPath } from '../../paths.js';
import { runScmCommand } from '../../runner.js';
import { runGitTask } from './config.js';
import { buildScmMetadataFailure } from '../../metadata-diagnostics.js';
import {
  createUnavailableFileMeta,
  normalizeFileMeta,
  toUniquePosixFiles
} from './prefetch.js';

const GIT_META_BATCH_FORMAT_PREFIX = '__POC_GIT_META__';
const GIT_META_BATCH_CHUNK_SIZE = 96;
const GIT_META_BATCH_CHUNK_SIZE_LARGE = 48;
const GIT_META_BATCH_CHUNK_SIZE_HUGE = 16;
const GIT_META_BATCH_FILESET_LARGE_MIN = 4000;
const GIT_META_BATCH_FILESET_HUGE_MIN = 8000;
const GIT_META_BATCH_COMMIT_LIMIT_DEFAULT = 2000;
const GIT_META_BATCH_COMMIT_LIMIT_HUGE_DEFAULT = 1000;
const GIT_META_TIMEOUT_RETRY_MAX_ATTEMPTS_DEFAULT = 3;
const GIT_META_TIMEOUT_MAX_MS_DEFAULT = 45 * 1000;

let gitMetaTimeoutState = new Map();

export const getGitMetaTimeoutState = () => gitMetaTimeoutState;

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

const resolveGitMetaBatchChunkSize = (fileCount) => {
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

const resolveGitMetaBatchCommitLimit = (fileCount, configuredLimit = null) => {
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

const HISTORY_MARKER = '\0\0' + GIT_META_BATCH_FORMAT_PREFIX;
const HISTORY_FORMAT = `%x00%x00${GIT_META_BATCH_FORMAT_PREFIX}%H%x00%aI%x00%an%x00`;

/** Decode one bounded Git history result. Double NUL commit framing cannot be
 * forged by a legal Git path; path fields retain tabs, newlines and whitespace. */
export const decodeGitMetaHistory = ({ stdout, repoRoot, numstat = false }) => {
  const fileMetaByPath = Object.create(null), churnByPath = Object.create(null);
  let requiresNameOnly = false;
  for (const section of String(stdout || '').split(HISTORY_MARKER).slice(1)) {
    const rows = section.split('\0');
    const lastCommitId = rows.shift(), lastModifiedAt = rows.shift(), lastAuthor = rows.shift();
    if (!/^[a-f0-9]{7,64}$/i.test(lastCommitId || '') || !Number.isFinite(Date.parse(lastModifiedAt))) {
      throw new Error('Invalid NUL-framed Git metadata header.');
    }
    const seen = new Set(); let first = true;
    const addMeta = raw => {
      const file = toRepoPosixPath(raw, repoRoot); if (!file) return null;
      if (!fileMetaByPath[file]) fileMetaByPath[file] = { lastCommitId: lastCommitId.toLowerCase(), lastModifiedAt,
        lastAuthor, churn: null, churnAdded: null, churnDeleted: null, churnCommits: null };
      return file;
    };
    for (let index = 0; index < rows.length; index++) {
      let row = rows[index]; if (!row) continue;
      if (first && row.startsWith('\n')) row = row.slice(1);
      first = false; if (!row || row === '\n') continue;
      if (!numstat) { addMeta(row); continue; }
      const match = /^(-|[0-9]+)\t(-|[0-9]+)\t([\s\S]*)$/.exec(row);
      if (!match) throw new Error('Invalid NUL-framed Git numstat row.');
      let label = match[3];
      if (!label) {
        // Rename/copy path selection differs from name-only history. Preserve
        // the numstat result and qualify metadata with the narrow cheap lane.
        const previous = rows[++index]; label = rows[++index];
        if (!previous || !label) throw new Error('Incomplete Git rename numstat row.');
        requiresNameOnly = true;
      }
      const file = addMeta(label); if (!file) continue;
      const churn = churnByPath[file] || { churn: 0, churnAdded: 0, churnDeleted: 0, churnCommits: 0 };
      churn.churnAdded += match[1] === '-' ? 0 : Number(match[1]);
      churn.churnDeleted += match[2] === '-' ? 0 : Number(match[2]);
      if (!seen.has(file)) { seen.add(file); churn.churnCommits++; }
      churn.churn = churn.churnAdded + churn.churnDeleted; churnByPath[file] = churn;
    }
  }
  if (String(stdout || '').length && !String(stdout).includes(HISTORY_MARKER)) throw new Error('Git metadata result has no qualified commit framing.');
  return { fileMetaByPath, churnByPath, requiresNameOnly };
};

const mergeGitMetaBatchChurn = ({ fileMetaByPath, churnByPath }) => {
  if (!fileMetaByPath || typeof fileMetaByPath !== 'object') return fileMetaByPath;
  for (const [fileKey, churnMeta] of Object.entries(churnByPath || {})) {
    if (!fileKey || !churnMeta || typeof churnMeta !== 'object') continue;
    const base = fileMetaByPath[fileKey] || createUnavailableFileMeta();
    fileMetaByPath[fileKey] = {
      ...base,
      churn: Number.isFinite(Number(churnMeta.churn)) ? Number(churnMeta.churn) : null,
      churnAdded: Number.isFinite(Number(churnMeta.churnAdded)) ? Number(churnMeta.churnAdded) : null,
      churnDeleted: Number.isFinite(Number(churnMeta.churnDeleted)) ? Number(churnMeta.churnDeleted) : null,
      churnCommits: Number.isFinite(Number(churnMeta.churnCommits)) ? Number(churnMeta.churnCommits) : null
    };
  }
  return fileMetaByPath;
};

const normalizeRepoRootKey = (repoRoot) => {
  const resolved = path.resolve(String(repoRoot || process.cwd()));
  return process.platform === 'win32'
    ? resolved.toLowerCase()
    : resolved;
};

const buildMetaPathScopeKey = (repoRoot, filePosix) => (
  `${normalizeRepoRootKey(repoRoot)}::${process.platform === 'win32' ? toPosix(filePosix) : filePosix}`
);

const toFailureMessage = (value, maxLength = 220) => {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
    : normalized;
};

const toFailureCode = (value) => {
  const code = String(value || '').trim().toUpperCase();
  return code || null;
};

const isTimeoutLikeFailure = ({ code, message }) => (
  code === 'SUBPROCESS_TIMEOUT'
  || code === 'ABORT_ERR'
  || /timed?\s*out/i.test(String(message || ''))
);

const isFatalUnavailableFailure = ({ code, message }) => {
  const lower = String(message || '').toLowerCase();
  return code === 'ENOENT'
    || lower.includes('not a git repository')
    || lower.includes('git metadata unavailable')
    || lower.includes('is not recognized as an internal or external command')
    || lower.includes('spawn git');
};

const createGitMetaBatchFailure = ({ err = null, result = null } = {}) => {
  const code = toFailureCode(
    err?.code
    || err?.cause?.code
    || (result?.exitCode != null ? `GIT_EXIT_${result.exitCode}` : '')
  );
  const message = toFailureMessage(
    err?.message
    || err?.cause?.message
    || result?.stderr
    || result?.stdout
    || ''
  );
  const timeoutLike = isTimeoutLikeFailure({ code, message });
  const fatalUnavailable = isFatalUnavailableFailure({ code, message });
  return {
    code,
    message: message || null,
    timeoutLike,
    fatalUnavailable
  };
};

const resolveFileSizeBytes = (repoRoot, filePosix) => {
  try {
    const absPath = path.join(repoRoot, filePosix);
    const stat = fsSync.statSync(absPath);
    const size = Number(stat?.size);
    return Number.isFinite(size) && size > 0 ? size : 0;
  } catch {
    return 0;
  }
};

const resolveChunkCost = ({ repoRoot, chunk, timeoutState }) => {
  let maxBytes = 0;
  let totalBytes = 0;
  let count = 0;
  let maxTimeouts = 0;
  for (const filePosix of Array.isArray(chunk) ? chunk : []) {
    const normalized = toPosix(filePosix);
    if (!normalized) continue;
    const bytes = resolveFileSizeBytes(repoRoot, normalized);
    maxBytes = Math.max(maxBytes, bytes);
    totalBytes += bytes;
    count += 1;
    const bucket = timeoutState.get(buildMetaPathScopeKey(repoRoot, normalized));
    const pathTimeouts = Number.isFinite(Number(bucket?.timeouts))
      ? Math.max(0, Math.floor(Number(bucket.timeouts)))
      : 0;
    maxTimeouts = Math.max(maxTimeouts, pathTimeouts);
  }
  const avgBytes = count > 0 ? Math.floor(totalBytes / count) : 0;
  const sizeTier = maxBytes >= 2 * 1024 * 1024
    ? 3
    : maxBytes >= 512 * 1024
      ? 2
      : maxBytes >= 128 * 1024
        ? 1
        : 0;
  const multiplier = Math.max(
    1,
    Math.min(
      4,
      1 + (sizeTier * 0.35) + Math.min(1.2, maxTimeouts * 0.2)
    )
  );
  return {
    maxBytes,
    avgBytes,
    sizeTier,
    maxTimeouts,
    multiplier
  };
};

const resolveTimeoutPlan = ({
  baseTimeoutMs,
  timeoutPolicy,
  chunkCost
}) => {
  const minTimeoutMs = Math.max(500, Math.floor(timeoutPolicy?.minTimeoutMs || 500));
  const maxTimeoutMs = Math.max(minTimeoutMs, Math.floor(timeoutPolicy?.maxTimeoutMs || GIT_META_TIMEOUT_MAX_MS_DEFAULT));
  const base = Number.isFinite(Number(baseTimeoutMs)) && Number(baseTimeoutMs) > 0
    ? Math.max(minTimeoutMs, Math.floor(Number(baseTimeoutMs)))
    : Math.max(minTimeoutMs, 15000);
  const target = Math.max(
    minTimeoutMs,
    Math.min(maxTimeoutMs, Math.floor(base * (chunkCost?.multiplier || 1)))
  );
  const attemptCap = Number.isFinite(Number(timeoutPolicy?.retryMaxAttempts))
    ? Math.max(1, Math.floor(Number(timeoutPolicy.retryMaxAttempts)))
    : GIT_META_TIMEOUT_RETRY_MAX_ATTEMPTS_DEFAULT;
  const adaptiveAttempts = 1 + Math.max(0, chunkCost?.sizeTier || 0) + Math.min(2, Math.max(0, chunkCost?.maxTimeouts || 0));
  const attempts = Math.max(1, Math.min(attemptCap, adaptiveAttempts));
  const ladder = [];
  for (let i = 0; i < attempts; i += 1) {
    const ratio = attempts <= 1 ? 1 : (0.6 + ((i / (attempts - 1)) * 0.4));
    const value = Math.max(minTimeoutMs, Math.min(maxTimeoutMs, Math.floor(target * ratio)));
    if (!ladder.includes(value)) ladder.push(value);
  }
  if (!ladder.length) ladder.push(target);
  return ladder;
};

export const createBatchDiagnostics = () => ({
  historyTraversals: 0,
  renameMetadataFallbacks: 0,
  historyStdoutBytes: 0,
  timeoutCount: 0,
  timeoutRetries: 0,
  cooldownSkips: 0,
  unavailableChunks: 0,
  failureCount: 0,
  failures: [],
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

export const runGitMetaBatchFetch = async ({
  repoRoot,
  filesPosix,
  timeoutMs,
  config,
  includeChurn = false
}) => {
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

  const recordTimeoutFailureBookkeeping = ({
    failure,
    chunk,
    timeoutMsForAttempt,
    attemptIndex,
    attemptCount,
    updateTimeoutState = false
  }) => {
    diagnostics.failureCount += 1;
    if (diagnostics.failures.length < 8) diagnostics.failures.push(buildScmMetadataFailure(failure, 'git-file-meta-batch'));
    else diagnostics.truncated = true;
    if (failure.timeoutLike) {
      diagnostics.timeoutCount += 1;
      for (const filePosix of chunk) {
        if (updateTimeoutState) {
          markTimeout(filePosix, timeoutMsForAttempt);
        } else {
          registerHeatEntry(heatByPath, filePosix, {
            timeout: true,
            timeoutMs: timeoutMsForAttempt
          });
        }
      }
    }
    const canRetry = failure.timeoutLike && attemptIndex < attemptCount - 1;
    if (canRetry) {
      diagnostics.timeoutRetries += 1;
      for (const filePosix of chunk) {
        registerHeatEntry(heatByPath, filePosix, { retry: true });
      }
    }
    return canRetry;
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
          '-c', 'core.quotePath=false',
          '-C',
          repoRoot,
          'log',
          '--date=iso-strict',
          `--format=${HISTORY_FORMAT}`, '-z',
          includeChurn === true ? '--numstat' : '--name-only'
        ];
        if (batchCommitLimit > 0) {
          args.push('-n', String(batchCommitLimit));
        }
        args.push('--', ...chunk);
        let result = null;
        try {
          diagnostics.historyTraversals++;
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
          if (recordTimeoutFailureBookkeeping({
            failure,
            chunk,
            timeoutMsForAttempt: attemptTimeoutMs,
            attemptIndex,
            attemptCount: timeoutPlan.length,
            updateTimeoutState: true
          })) {
            continue;
          }
          break;
        }
        if (result?.exitCode === 0) {
          diagnostics.historyStdoutBytes += Buffer.byteLength(result.stdout || '');
          const decoded = decodeGitMetaHistory({ stdout: result.stdout, repoRoot, numstat: includeChurn === true });
          parsedMetaByPath = decoded.fileMetaByPath;
          if (includeChurn === true && decoded.requiresNameOnly) {
            diagnostics.renameMetadataFallbacks++;
            const nameArgs = args.map(argument => argument === '--numstat' ? '--name-only' : argument);
            let nameResult;
            try {
              diagnostics.historyTraversals++;
              nameResult = await runGitTask(() => runScmCommand('git', nameArgs, {
                outputMode: 'string', captureStdout: true, captureStderr: true,
                rejectOnNonZeroExit: false, timeoutMs: attemptTimeoutMs
              }), { useQueue: config.maxConcurrentProcesses > 1, timeoutState: gitMetaTimeoutState });
            } catch (err) {
              failure = createGitMetaBatchFailure({ err }); parsedMetaByPath = null;
            }
            if (!failure && nameResult?.exitCode !== 0) { failure = createGitMetaBatchFailure({ result: nameResult }); parsedMetaByPath = null; }
            if (failure) {
              if (recordTimeoutFailureBookkeeping({ failure, chunk, timeoutMsForAttempt: attemptTimeoutMs,
                attemptIndex, attemptCount: timeoutPlan.length, updateTimeoutState: true })) continue;
              break;
            }
            diagnostics.historyStdoutBytes += Buffer.byteLength(nameResult.stdout || '');
            parsedMetaByPath = decodeGitMetaHistory({ stdout: nameResult.stdout, repoRoot }).fileMetaByPath;
          }
          if (includeChurn === true) mergeGitMetaBatchChurn({ fileMetaByPath: parsedMetaByPath, churnByPath: decoded.churnByPath });
          for (const filePosix of chunk) {
            clearTimeoutState(filePosix);
          }
          failure = null;
          break;
        }
        failure = createGitMetaBatchFailure({ result });
        if (recordTimeoutFailureBookkeeping({
          failure,
          chunk,
          timeoutMsForAttempt: attemptTimeoutMs,
          attemptIndex,
          attemptCount: timeoutPlan.length,
          updateTimeoutState: true
        })) {
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
        return { ok: false, fatal: true, reason: failure.message || 'unavailable',
          failure: buildScmMetadataFailure(failure, 'git-file-meta-batch') };
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
        failure: chunkResult.failure || null,
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
