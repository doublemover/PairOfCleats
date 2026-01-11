import fsSync from 'node:fs';
import path from 'node:path';
import Piscina from 'piscina';
import { readBundleFile } from '../../../shared/bundle-io.js';

export const createBundleLoader = ({ bundleThreads, workerPath }) => {
  const useWorkers = Number.isFinite(bundleThreads) && bundleThreads > 1;
  const pool = useWorkers && workerPath
    ? new Piscina({ filename: workerPath, maxThreads: bundleThreads })
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
