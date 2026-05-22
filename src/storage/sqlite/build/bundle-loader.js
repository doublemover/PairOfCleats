import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Piscina from 'piscina';
import { resolveManifestBundleNamesResult } from '../../../shared/bundle-io-paths.js';
import { readBundleFile } from '../../../shared/bundle-io.js';
import { destroyPiscinaPool } from '../../../shared/piscina-cleanup.js';
import { createTimeoutError, runWithTimeout } from '../../../shared/promise-timeout.js';
import {
  buildWorkerExecArgv,
  parseMaxOldSpaceSizeMb
} from '../../../shared/workers/node-argv.js';

const resolveWorkerResourceLimits = (maxWorkers) => {
  const workerCount = Math.max(1, Math.floor(Number(maxWorkers) || 1));
  const totalMemMb = Math.floor(os.totalmem() / 1024 / 1024);
  const maxOldMb = parseMaxOldSpaceSizeMb(process.execArgv);
  const basisMb = Math.max(256, Math.min(2048, Math.min(totalMemMb, maxOldMb || totalMemMb)));
  const perWorkerMb = Math.floor(basisMb / (workerCount * 2));
  const minMb = 128;
  const platformCap = process.platform === 'win32' ? 256 : 512;
  const oldGenMb = Math.max(minMb, Math.min(platformCap, perWorkerMb));
  return { maxOldGenerationSizeMb: oldGenMb };
};

export const createBundleLoader = ({ bundleThreads, workerPath }) => {
  const bundleTaskTimeoutMs = 30_000;
  const useWorkers = Number.isFinite(bundleThreads) && bundleThreads > 1 && Boolean(workerPath);
  const pool = useWorkers && workerPath
    ? new Piscina({
      filename: workerPath,
      maxThreads: bundleThreads,
      execArgv: buildWorkerExecArgv(),
      taskTimeout: bundleTaskTimeoutMs,
      resourceLimits: resolveWorkerResourceLimits(bundleThreads)
    })
    : null;
  let workerAvailable = Boolean(pool);
  let workerPoolDestroyed = false;
  let destroyPromise = null;

  const destroyWorkerPool = async () => {
    if (!pool) return;
    if (destroyPromise) return destroyPromise;
    workerPoolDestroyed = true;
    workerAvailable = false;
    destroyPromise = (async () => {
      try {
        await destroyPiscinaPool(pool, {
          label: 'sqlite.bundle-loader.worker-pool'
        });
      } catch {}
    })();
    return destroyPromise;
  };

  const disableWorkerPool = async () => {
    if (!pool || workerPoolDestroyed) return;
    await destroyWorkerPool();
  };

  const loadBundleDirect = async (bundlePath, file) => {
    const result = await readBundleFile(bundlePath);
    if (!result.ok) {
      return {
        file,
        ok: false,
        reason: `bundle read failed (${bundlePath}): ${result.reason || 'invalid bundle'}`
      };
    }
    return { file, ok: true, bundleShards: [result.bundle] };
  };

  const loadBundle = async ({ bundleDir, entry, file }) => {
    const bundleNameResult = resolveManifestBundleNamesResult(entry);
    const bundleNames = bundleNameResult.names;
    if (!bundleNames.length) {
      return {
        file,
        ok: false,
        reason: bundleNameResult.reason || 'missing bundle entries'
      };
    }
    const loadedShards = [];
    for (let shardIndex = 0; shardIndex < bundleNames.length; shardIndex += 1) {
      const bundlePath = path.join(bundleDir, bundleNames[shardIndex]);
      if (!fsSync.existsSync(bundlePath)) {
        return { file, ok: false, reason: `bundle file missing (${bundlePath})` };
      }
      try {
        if (pool && workerAvailable) {
          try {
            const result = await runWithTimeout(
              () => pool.run({ bundlePath }),
              {
                timeoutMs: bundleTaskTimeoutMs,
                errorFactory: () => createTimeoutError({
                  message: `bundle worker timed out (${bundlePath}) after ${bundleTaskTimeoutMs}ms`,
                  code: 'SQLITE_BUNDLE_WORKER_TIMEOUT',
                  retryable: false
                })
              }
            );
            if (!result?.ok) {
              const reason = result?.reason || 'invalid bundle';
              return { file, ok: false, reason: `bundle read failed (${bundlePath}): ${reason}` };
            }
            loadedShards.push(result.bundle);
            continue;
          } catch {
            await disableWorkerPool();
          }
        }
        const loaded = await loadBundleDirect(bundlePath, file);
        if (!loaded.ok) return loaded;
        loadedShards.push(...loaded.bundleShards);
      } catch (err) {
        return { file, ok: false, reason: `bundle read failed (${bundlePath}): ${err?.message || err}` };
      }
    }
    return { file, ok: true, bundleShards: loadedShards };
  };

  const close = async () => {
    await destroyWorkerPool();
  };

  return { loadBundle, close, useWorkers };
};
