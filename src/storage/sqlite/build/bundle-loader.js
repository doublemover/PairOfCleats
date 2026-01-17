import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Piscina from 'piscina';
import { readBundleFile } from '../../../shared/bundle-io.js';

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
  const useWorkers = Number.isFinite(bundleThreads) && bundleThreads > 1;
  const pool = useWorkers && workerPath
    ? new Piscina({
      filename: workerPath,
      maxThreads: bundleThreads,
      execArgv: buildWorkerExecArgv(),
      resourceLimits: resolveWorkerResourceLimits(bundleThreads)
    })
    : null;

  const loadBundle = async ({ bundleDir, entry, file }) => {
    const bundleName = entry?.bundle;
    if (!bundleName) {
      return { file, ok: false, reason: 'missing bundle entry' };
    }
    const bundlePath = path.join(bundleDir, bundleName);
    if (!fsSync.existsSync(bundlePath)) {
      return { file, ok: false, reason: 'bundle file missing' };
    }
    try {
      if (pool) {
        const result = await pool.run({ bundlePath });
        if (!result?.ok) {
          return { file, ok: false, reason: result?.reason || 'invalid bundle' };
        }
        return { file, ok: true, bundle: result.bundle };
      }
      const result = await readBundleFile(bundlePath);
      if (!result.ok) {
        return { file, ok: false, reason: result.reason || 'invalid bundle' };
      }
      return { file, ok: true, bundle: result.bundle };
    } catch (err) {
      return { file, ok: false, reason: err?.message || String(err) };
    }
  };

  const close = async () => {
    if (pool) {
      await pool.destroy();
    }
  };

  return { loadBundle, close, useWorkers };
};
