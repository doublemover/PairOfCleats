import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Piscina from 'piscina';
import { readBundleFile, resolveManifestBundleNames } from '../../../shared/bundle-io.js';

const buildWorkerExecArgv = () => process.execArgv.filter((arg) => (
  typeof arg === 'string'
  && !arg.startsWith('--max-old-space-size')
  && !arg.startsWith('--max-semi-space-size')
));

const parseMaxOldSpaceSizeMb = (argv) => {
  if (!Array.isArray(argv)) return null;
  for (let i = argv.length - 1; i >= 0; i -= 1) {
    const arg = argv[i];
    if (typeof arg !== 'string') continue;
    if (arg === '--max-old-space-size' && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) return Math.floor(value);
    }
    if (arg.startsWith('--max-old-space-size=')) {
      const value = Number(arg.split('=', 2)[1]);
      if (Number.isFinite(value) && value > 0) return Math.floor(value);
    }
  }
  return null;
};

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
  const useWorkers = Number.isFinite(bundleThreads) && bundleThreads > 1 && Boolean(workerPath);
  const pool = useWorkers && workerPath
    ? new Piscina({
      filename: workerPath,
      maxThreads: bundleThreads,
      execArgv: buildWorkerExecArgv(),
      resourceLimits: resolveWorkerResourceLimits(bundleThreads)
    })
    : null;
  let workerAvailable = Boolean(pool);

  const loadBundleDirect = async (bundlePath, file) => {
    const result = await readBundleFile(bundlePath);
    if (!result.ok) {
      return {
        file,
        ok: false,
        reason: `bundle read failed (${bundlePath}): ${result.reason || 'invalid bundle'}`
      };
    }
    return { file, ok: true, bundle: result.bundle };
  };

  const loadBundle = async ({ bundleDir, entry, file }) => {
    const bundleNames = resolveManifestBundleNames(entry);
    if (!bundleNames.length) {
      return { file, ok: false, reason: 'missing bundle entries' };
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
            const result = await pool.run({ bundlePath });
            if (!result?.ok) {
              const reason = result?.reason || 'invalid bundle';
              return { file, ok: false, reason: `bundle read failed (${bundlePath}): ${reason}` };
            }
            loadedShards.push(result.bundle);
            continue;
          } catch {
            workerAvailable = false;
          }
        }
        const loaded = await loadBundleDirect(bundlePath, file);
        if (!loaded.ok) return loaded;
        loadedShards.push(loaded.bundle);
      } catch (err) {
        return { file, ok: false, reason: `bundle read failed (${bundlePath}): ${err?.message || err}` };
      }
    }
    return { file, ok: true, bundleShards: loadedShards };
  };

  const close = async () => {
    if (pool) {
      await pool.destroy();
    }
  };

  return { loadBundle, close, useWorkers };
};
