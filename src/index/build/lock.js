import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_STALE_MS = 30 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isProcessAlive = (pid) => {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    if (err?.code === 'EPERM') return true;
    return false;
  }
  if (process.platform !== 'win32') return true;
  try {
    const result = spawnSync(
      'tasklist',
      ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', windowsHide: true }
    );
    if (result.error) return true;
    const output = String(result.stdout || '').trim();
    if (!output) return false;
    if (/INFO:\s+No tasks are running/i.test(output)) return false;
    const line = output.split(/\r?\n/)[0] || '';
    const parts = line.split('","').map((part) => part.replace(/^"|"$/g, ''));
    const pidText = parts[1] || '';
    const parsedPid = Number(pidText);
    if (Number.isFinite(parsedPid)) return parsedPid === pid;
  } catch {
    return true;
  }
  return true;
};

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
          log(`Removed stale index lock at ${lockPath}.`);
          continue;
        } catch {}
      }
      const info = await readLockInfo(lockPath);
      const pid = Number.isFinite(info?.pid) ? Number(info.pid) : null;
      if (pid && !isProcessAlive(pid)) {
        try {
          await fs.rm(lockPath, { force: true });
          log(`Removed stale index lock at ${lockPath} (pid ${pid} not running).`);
          continue;
        } catch {}
      }
      if (waitMs > 0 && Date.now() < deadline) {
        await sleep(pollMs);
        continue;
      }
      const detailInfo = info || (fsSync.existsSync(lockPath) ? await readLockInfo(lockPath) : null);
      const detail = detailInfo?.pid ? ` (pid ${detailInfo.pid})` : '';
      log(`Index lock held, skipping build${detail}.`);
      return null;
    }
  }
}
