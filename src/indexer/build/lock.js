import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const DEFAULT_STALE_MS = 30 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readLockInfo = async (lockPath) => {
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const isLockStale = async (lockPath, staleMs) => {
  try {
    const info = await readLockInfo(lockPath);
    if (info?.startedAt) {
      const started = Date.parse(info.startedAt);
      if (Number.isFinite(started) && Date.now() - started > staleMs) return true;
    }
    const stat = await fs.stat(lockPath);
    return Date.now() - stat.mtimeMs > staleMs;
  } catch {
    return false;
  }
};

/**
 * Acquire a repo-scoped index lock to prevent concurrent writes.
 * @param {{repoCacheRoot:string,waitMs?:number,pollMs?:number,staleMs?:number,log?:(msg:string)=>void}} input
 * @returns {Promise<{lockPath:string,release:()=>Promise<void>}|null>}
 */
export async function acquireIndexLock({
  repoCacheRoot,
  waitMs = 0,
  pollMs = 1000,
  staleMs = DEFAULT_STALE_MS,
  log = () => {}
}) {
  const lockDir = path.join(repoCacheRoot, 'locks');
  const lockPath = path.join(lockDir, 'index.lock');
  await fs.mkdir(lockDir, { recursive: true });
  const deadline = waitMs > 0 ? Date.now() + waitMs : 0;

  while (true) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      const payload = {
        pid: process.pid,
        startedAt: new Date().toISOString()
      };
      await handle.writeFile(JSON.stringify(payload));
      await handle.close();
      return {
        lockPath,
        release: async () => {
          try {
            await fs.rm(lockPath, { force: true });
          } catch {}
        }
      };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      const stale = await isLockStale(lockPath, staleMs);
      if (stale) {
        try {
          await fs.rm(lockPath, { force: true });
          continue;
        } catch {}
      }
      if (waitMs > 0 && Date.now() < deadline) {
        await sleep(pollMs);
        continue;
      }
      const info = fsSync.existsSync(lockPath) ? await readLockInfo(lockPath) : null;
      const detail = info?.pid ? ` (pid ${info.pid})` : '';
      log(`Index lock held, skipping build${detail}.`);
      return null;
    }
  }
}
