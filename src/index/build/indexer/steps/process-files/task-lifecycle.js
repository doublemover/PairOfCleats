import { createTimeoutError, runWithTimeout } from '../../../../../shared/promise-timeout.js';
import { createLifecycleRegistry } from '../../../../../shared/lifecycle/registry.js';
import { normalizeOwnershipSegment } from './ordering.js';

const FILE_PROCESS_CLEANUP_TIMEOUT_DEFAULT_MS = 30000;

export const resolveStage1FileSubprocessOwnershipPrefix = (runtime, mode = 'unknown') => {
  const configuredPrefix = typeof runtime?.subprocessOwnership?.stage1FilePrefix === 'string'
    ? runtime.subprocessOwnership.stage1FilePrefix.trim()
    : '';
  if (configuredPrefix) {
    return `${configuredPrefix}:${normalizeOwnershipSegment(mode, 'mode')}`;
  }
  const fallbackBuildId = normalizeOwnershipSegment(runtime?.buildId, 'build');
  return `stage1:${fallbackBuildId}:${normalizeOwnershipSegment(mode, 'mode')}`;
};

export const buildStage1FileSubprocessOwnershipId = ({
  runtime,
  mode = 'unknown',
  fileIndex = null,
  rel = '',
  shardId = null
} = {}) => {
  const prefix = resolveStage1FileSubprocessOwnershipPrefix(runtime, mode);
  const normalizedFileIndex = Number.isFinite(Number(fileIndex))
    ? Math.max(0, Math.floor(Number(fileIndex)))
    : 'na';
  const normalizedRel = normalizeOwnershipSegment(rel, 'unknown_file');
  const normalizedShardId = normalizeOwnershipSegment(String(shardId || 'none'), 'none');
  return `${prefix}:shard:${normalizedShardId}:file:${normalizedFileIndex}:${normalizedRel}`;
};

export const runCleanupWithTimeout = async ({
  label,
  cleanup,
  timeoutMs = FILE_PROCESS_CLEANUP_TIMEOUT_DEFAULT_MS,
  log = null,
  logMeta = null,
  onTimeout = null
}) => {
  if (typeof cleanup !== 'function') return { skipped: true, timedOut: false, elapsedMs: 0 };
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    const startAtMs = Date.now();
    await cleanup();
    return { skipped: false, timedOut: false, elapsedMs: Date.now() - startAtMs };
  }
  const startedAtMs = Date.now();
  try {
    await runWithTimeout(
      () => cleanup(),
      {
        timeoutMs,
        errorFactory: () => createTimeoutError({
          message: `[cleanup] ${label || 'cleanup'} timed out after ${timeoutMs}ms`,
          code: 'PROCESS_CLEANUP_TIMEOUT',
          retryable: false,
          meta: {
            label: label || 'cleanup',
            timeoutMs
          }
        })
      }
    );
    return { skipped: false, timedOut: false, elapsedMs: Date.now() - startedAtMs };
  } catch (err) {
    if (err?.code !== 'PROCESS_CLEANUP_TIMEOUT') throw err;
    const elapsedMs = Date.now() - startedAtMs;
    if (typeof log === 'function') {
      log(
        `[cleanup] ${label || 'cleanup'} timed out after ${timeoutMs}ms; continuing.`,
        {
          kind: 'warning',
          ...(logMeta && typeof logMeta === 'object' ? logMeta : {}),
          cleanupLabel: label || 'cleanup',
          timeoutMs,
          elapsedMs
        }
      );
    }
    if (typeof onTimeout === 'function') {
      try {
        await onTimeout(err);
      } catch {}
    }
    return { skipped: false, timedOut: true, elapsedMs, error: err };
  }
};

export const runStage1TailCleanupTasks = async ({
  tasks = [],
  logSummary = null,
  sequential = false
} = {}) => {
  const cleanupTasks = Array.isArray(tasks)
    ? tasks.filter((task) => typeof task?.run === 'function')
    : [];
  if (!cleanupTasks.length) return [];
  const startedAtMs = Date.now();
  const runTask = async (task, index) => {
    const result = await task.run();
    return {
      label: typeof task.label === 'string' && task.label.trim()
        ? task.label.trim()
        : `cleanup-${index + 1}`,
      skipped: result?.skipped === true,
      timedOut: result?.timedOut === true,
      elapsedMs: Number.isFinite(result?.elapsedMs)
        ? Math.max(0, Math.floor(Number(result.elapsedMs)))
        : 0,
      error: result?.error
    };
  };
  const settled = sequential
    ? await (async () => {
      const results = [];
      for (let index = 0; index < cleanupTasks.length; index += 1) {
        try {
          results.push({
            status: 'fulfilled',
            value: await runTask(cleanupTasks[index], index)
          });
        } catch (error) {
          results.push({
            status: 'rejected',
            reason: error
          });
        }
      }
      return results;
    })()
    : await Promise.allSettled(cleanupTasks.map((task, index) => runTask(task, index)));
  const outcomes = [];
  const fatalErrors = [];
  settled.forEach((entry, index) => {
    const task = cleanupTasks[index] || {};
    const label = typeof task.label === 'string' && task.label.trim()
      ? task.label.trim()
      : `cleanup-${index + 1}`;
    if (entry.status === 'fulfilled') {
      outcomes.push(entry.value);
      return;
    }
    const error = entry.reason;
    outcomes.push({
      label,
      skipped: false,
      timedOut: false,
      elapsedMs: 0,
      error
    });
    fatalErrors.push({ label, error });
  });
  if (typeof logSummary === 'function') {
    try {
      logSummary({
        outcomes,
        elapsedMs: Math.max(0, Date.now() - startedAtMs),
        fatalErrors
      });
    } catch {}
  }
  if (fatalErrors.length > 0) {
    throw fatalErrors[0].error;
  }
  return outcomes;
};

const normalizeTrackedProcessFileTaskMeta = (meta = {}) => ({
  file: typeof meta?.file === 'string' && meta.file.trim() ? meta.file.trim() : null,
  fileIndex: Number.isFinite(Number(meta?.fileIndex)) ? Math.floor(Number(meta.fileIndex)) : null,
  orderIndex: Number.isFinite(Number(meta?.orderIndex)) ? Math.floor(Number(meta.orderIndex)) : null,
  shardId: typeof meta?.shardId === 'string' && meta.shardId.trim() ? meta.shardId.trim() : null,
  ownershipId: typeof meta?.ownershipId === 'string' && meta.ownershipId.trim() ? meta.ownershipId.trim() : null,
  startedAtMs: Number.isFinite(Number(meta?.startedAtMs))
    ? Math.max(0, Math.floor(Number(meta.startedAtMs)))
    : Date.now()
});

export const buildTrackedProcessFileTaskSummaryText = (
  entries = [],
  maxEntries = 8
) => {
  const list = Array.isArray(entries) ? entries : [];
  const safeMaxEntries = Number.isFinite(Number(maxEntries))
    ? Math.max(1, Math.floor(Number(maxEntries)))
    : 8;
  const preview = list
    .slice(0, safeMaxEntries)
    .map((entry) => {
      const file = entry?.file || 'unknown';
      const fileIndex = Number.isFinite(Number(entry?.fileIndex))
        ? `#${Math.floor(Number(entry.fileIndex))}`
        : '#?';
      const orderIndex = Number.isFinite(Number(entry?.orderIndex))
        ? `seq=${Math.floor(Number(entry.orderIndex))}`
        : null;
      const shardId = entry?.shardId ? `shard=${entry.shardId}` : null;
      const ageMs = Number.isFinite(Number(entry?.ageMs))
        ? `age=${Math.max(0, Math.floor(Number(entry.ageMs)))}ms`
        : null;
      return [fileIndex, file, orderIndex, shardId, ageMs].filter(Boolean).join(' ');
    });
  const remainder = list.length > preview.length
    ? ` (+${list.length - preview.length} more)`
    : '';
  return preview.length ? `${preview.join('; ')}${remainder}` : 'none';
};

export const createTrackedProcessFileTaskRegistry = ({
  name = 'stage1-process-file-tasks',
  now = () => Date.now()
} = {}) => {
  const lifecycle = createLifecycleRegistry({ name });
  const pending = new Map();
  let nextId = 0;
  let sealed = false;
  let sealReason = null;

  const snapshot = () => Array.from(pending.entries())
    .map(([id, entry]) => ({
      id,
      ...entry,
      ageMs: Math.max(0, now() - (Number(entry?.startedAtMs) || now()))
    }))
    .sort((left, right) => {
      const rightAge = Number.isFinite(Number(right?.ageMs)) ? Number(right.ageMs) : -1;
      const leftAge = Number.isFinite(Number(left?.ageMs)) ? Number(left.ageMs) : -1;
      if (rightAge !== leftAge) return rightAge - leftAge;
      const leftIndex = Number.isFinite(Number(left?.fileIndex)) ? Number(left.fileIndex) : Number.MAX_SAFE_INTEGER;
      const rightIndex = Number.isFinite(Number(right?.fileIndex)) ? Number(right.fileIndex) : Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });

  const track = (promise, meta = {}) => {
    if (!promise || typeof promise.then !== 'function') return promise;
    if (sealed) {
      const err = new Error(
        `[stage1] ${name} is sealed; refusing new process-file task`
        + `${sealReason ? ` (${sealReason})` : ''}.`
      );
      err.code = 'ERR_STAGE1_PROCESS_FILE_TASK_REGISTRY_SEALED';
      throw err;
    }
    const id = nextId + 1;
    nextId = id;
    pending.set(id, normalizeTrackedProcessFileTaskMeta(meta));
    const tracked = lifecycle.registerPromise(Promise.resolve(promise), {
      label: typeof meta?.file === 'string' && meta.file.trim()
        ? `process-file:${meta.file.trim()}`
        : `process-file:${id}`
    });
    void tracked.then(
      () => {
        pending.delete(id);
      },
      () => {
        pending.delete(id);
      }
    );
    return tracked;
  };

  return {
    track,
    seal: (reason = null) => {
      sealed = true;
      sealReason = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
    },
    isSealed: () => sealed,
    snapshot,
    pendingCount: () => pending.size,
    drain: () => lifecycle.drain()
  };
};

export const drainTrackedProcessFileTasks = async ({
  registry = null,
  timeoutMs = FILE_PROCESS_CLEANUP_TIMEOUT_DEFAULT_MS,
  log = null,
  logMeta = null,
  onTimeout = null,
  snapshotLimit = 8
} = {}) => {
  if (!registry || typeof registry.drain !== 'function') {
    return { skipped: true, timedOut: false, elapsedMs: 0 };
  }
  return runCleanupWithTimeout({
    label: 'stage1.process-file-drain',
    cleanup: () => registry.drain(),
    timeoutMs,
    log,
    logMeta,
    onTimeout: async (error) => {
      const pendingEntries = typeof registry.snapshot === 'function' ? registry.snapshot() : [];
      if (typeof log === 'function' && pendingEntries.length > 0) {
        log(
          `[cleanup] stage1 process-file drain timed out with ${pendingEntries.length} pending task(s): `
            + `${buildTrackedProcessFileTaskSummaryText(pendingEntries, snapshotLimit)}`,
          {
            kind: 'warning',
            ...(logMeta && typeof logMeta === 'object' ? logMeta : {}),
            cleanupLabel: 'stage1.process-file-drain',
            pendingCount: pendingEntries.length,
            pendingEntries: pendingEntries.slice(0, snapshotLimit)
          }
        );
      }
      if (typeof onTimeout === 'function') {
        await onTimeout(error, pendingEntries);
      }
    }
  });
};
