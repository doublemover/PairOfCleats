import fs from 'node:fs/promises';
import path from 'node:path';
import { toPosix } from '../../../shared/file-paths.js';
import { removePathWithRetry } from '../../../shared/io/remove-path-with-retry.js';
import {
  cleanupVectorOnlySparseArtifacts,
  removeCompressedArtifact,
  removePackedPostings
} from '../artifacts/sparse-cleanup.js';

const cleanupPathExists = async (targetPath) => {
  if (!targetPath) return false;
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

export const prepareArtifactCleanup = async ({
  outDir,
  log,
  logLine,
  vectorOnlyProfile,
  tokenPostingsFormat,
  tokenPostingsUseShards,
  effectiveAbortSignal,
  indexState,
  profileId,
  removePieceFile
} = {}) => {
  const cleanupActions = [];
  const stagedCleanupOperations = [];
  const runCleanupBatch = async (operations, { concurrency = 3 } = {}) => {
    const tasks = Array.isArray(operations) ? operations.filter((op) => typeof op === 'function') : [];
    const batchSize = Number.isFinite(Number(concurrency))
      ? Math.max(1, Math.floor(Number(concurrency)))
      : 3;
    for (let i = 0; i < tasks.length; i += batchSize) {
      await Promise.all(tasks.slice(i, i + batchSize).map((task) => task()));
    }
  };
  const recordCleanupAction = ({ targetPath, recursive = false, policy = 'legacy', phase = 'staged' }) => {
    if (!targetPath) return;
    const action = {
      path: toPosix(path.relative(outDir, targetPath)),
      recursive: recursive === true,
      policy,
      phase
    };
    cleanupActions.push(action);
    return action;
  };
  const syncCleanupState = (summary = null) => {
    if (!indexState || typeof indexState !== 'object') return;
    if (!indexState.extensions || typeof indexState.extensions !== 'object') {
      indexState.extensions = {};
    }
    const existing = indexState.extensions.artifactCleanup;
    indexState.extensions.artifactCleanup = {
      schemaVersion: 2,
      profileId,
      allowlistOnly: vectorOnlyProfile,
      status: summary?.status || (cleanupActions.length ? 'staged' : 'not-required'),
      plannedActions: cleanupActions.length,
      completedActions: Number.isFinite(Number(summary?.completedActions))
        ? Number(summary.completedActions)
        : 0,
      failedActions: Number.isFinite(Number(summary?.failedActions))
        ? Number(summary.failedActions)
        : 0,
      actions: cleanupActions,
      failures: Array.isArray(summary?.failures) ? summary.failures : [],
      previousSchemaVersion: Number.isFinite(Number(existing?.schemaVersion))
        ? Number(existing.schemaVersion)
        : null
    };
  };
  const removeArtifactNow = async (targetPath, options = {}) => {
    const { recursive = true, policy = 'legacy' } = options;
    try {
      const exists = await cleanupPathExists(targetPath);
      if (exists) {
        logLine?.(`[artifact-cleanup] remove ${targetPath}`, { kind: 'status' });
      }
      const removed = await removePathWithRetry(targetPath, { recursive, force: true });
      if (removed?.ok) {
        removePieceFile?.(targetPath);
      }
      if (!removed?.ok) {
        throw removed?.error || new Error(`[artifact-cleanup] failed to remove ${targetPath}`);
      }
    } catch (err) {
      log?.(`[warn] [artifact-cleanup] exception removing ${targetPath}: ${err?.message || err}`);
      throw err;
    }
  };
  const removeArtifact = async (targetPath, options = {}) => {
    const { recursive = true, policy = 'legacy', immediate = false } = options;
    const exists = await cleanupPathExists(targetPath);
    if (!exists) return { ok: true, staged: false, targetPath };
    if (immediate) {
      recordCleanupAction({ targetPath, recursive, policy, phase: 'immediate' });
      await removeArtifactNow(targetPath, { recursive, policy });
      syncCleanupState();
      return { ok: true, staged: false, targetPath };
    }
    const action = recordCleanupAction({ targetPath, recursive, policy, phase: 'staged' });
    logLine?.(`[artifact-cleanup] stage remove ${targetPath}`, { kind: 'status' });
    stagedCleanupOperations.push({
      action,
      targetPath: path.resolve(targetPath),
      run: async () => {
        await removeArtifactNow(targetPath, { recursive, policy });
        return action;
      }
    });
    syncCleanupState();
    return { ok: true, staged: true, targetPath };
  };
  const commitArtifactCleanup = async ({
    concurrency = 3,
    immutablePaths = []
  } = {}) => {
    const failures = [];
    let completedActions = 0;
    const tasks = stagedCleanupOperations.splice(0, stagedCleanupOperations.length);
    const immutablePathSet = new Set(
      (Array.isArray(immutablePaths) ? immutablePaths : [])
        .filter((targetPath) => typeof targetPath === 'string' && targetPath.trim())
        .map((targetPath) => path.resolve(targetPath))
    );
    const batchSize = Number.isFinite(Number(concurrency))
      ? Math.max(1, Math.floor(Number(concurrency)))
      : 3;
    for (let index = 0; index < tasks.length; index += batchSize) {
      const batch = tasks.slice(index, index + batchSize);
      const results = await Promise.all(batch.map(async (task) => {
        if (immutablePathSet.has(task.targetPath)) {
          return {
            ok: false,
            error: new Error(
              `[artifact-cleanup] refusing to remove committed artifact from current generation: `
              + `${toPosix(path.relative(outDir, task.targetPath))}`
            )
          };
        }
        try {
          await task.run();
          return { ok: true };
        } catch (error) {
          return { ok: false, error };
        }
      }));
      for (const result of results) {
        if (result.ok) {
          completedActions += 1;
          continue;
        }
        failures.push({
          message: result.error?.message || String(result.error)
        });
      }
    }
    const summary = {
      schemaVersion: 1,
      status: failures.length ? 'completed-with-warnings' : (cleanupActions.length ? 'completed' : 'not-required'),
      plannedActions: cleanupActions.length,
      completedActions,
      failedActions: failures.length,
      failures
    };
    syncCleanupState(summary);
    return {
      ...summary,
      actions: cleanupActions
    };
  };

  if (vectorOnlyProfile) {
    await cleanupVectorOnlySparseArtifacts({
      outDir,
      removeArtifact,
      abortSignal: effectiveAbortSignal
    });
  } else {
    if (tokenPostingsFormat === 'packed') {
      await runCleanupBatch([
        () => removeArtifact(path.join(outDir, 'token_postings.json'), { policy: 'format_cleanup' }),
        () => removeCompressedArtifact({ outDir, base: 'token_postings', removeArtifact }),
        () => removeArtifact(path.join(outDir, 'token_postings.meta.json'), { policy: 'format_cleanup' }),
        () => removeArtifact(path.join(outDir, 'token_postings.shards'), {
          recursive: true,
          policy: 'format_cleanup'
        })
      ]);
    } else {
      await removePackedPostings({ outDir, removeArtifact });
    }
    if (tokenPostingsUseShards) {
      await runCleanupBatch([
        () => removeArtifact(path.join(outDir, 'token_postings.json'), { policy: 'format_cleanup' }),
        () => removeCompressedArtifact({ outDir, base: 'token_postings', removeArtifact }),
        () => removeArtifact(path.join(outDir, 'token_postings.shards'), {
          recursive: true,
          policy: 'format_cleanup'
        })
      ]);
    } else {
      await runCleanupBatch([
        () => removeArtifact(path.join(outDir, 'token_postings.meta.json'), { policy: 'format_cleanup' }),
        () => removeArtifact(path.join(outDir, 'token_postings.shards'), {
          recursive: true,
          policy: 'format_cleanup'
        })
      ]);
    }
  }
  syncCleanupState();

  return {
    cleanupActions,
    commitArtifactCleanup,
    runCleanupBatch,
    removeArtifact
  };
};
