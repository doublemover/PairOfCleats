import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { runSyncCommandWithTimeout, toSyncCommandExitCode } from '../subprocess/sync-command.js';
import { DEFAULT_WINDOWS_TASKLIST_TIMEOUT_MS } from './file-lock-constants.js';
import { readLockInfo, readLockInfoSync, resolveLockPid } from './file-lock-info.js';

export const isProcessAlive = (pid) => {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    if (err?.code === 'EPERM') return true;
    return false;
  }
  if (process.platform !== 'win32') return true;
  try {
    const result = runSyncCommandWithTimeout(
      'tasklist',
      ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeoutMs: DEFAULT_WINDOWS_TASKLIST_TIMEOUT_MS
      }
    );
    if (toSyncCommandExitCode(result) == null && result?.error) {
      return true;
    }
    const output = String(result.stdout || '').trim();
    if (!output || /INFO:\s+No tasks are running/i.test(output)) return false;
    const line = output.split(/\r?\n/)[0] || '';
    const parts = line.split('","').map((part) => part.replace(/^"|"$/g, ''));
    const parsedPid = Number(parts[1] || '');
    return Number.isFinite(parsedPid) ? parsedPid === pid : true;
  } catch {
    return true;
  }
};

export const isOwnedBy = (info, owner) => {
  if (!owner || typeof owner !== 'object') return false;
  if (owner.lockId && info?.lockId) return owner.lockId === info.lockId;
  if (Number.isFinite(owner.pid) && Number.isFinite(Number(info?.pid))) {
    return Number(owner.pid) === Number(info.pid);
  }
  return false;
};

export const removeLockFileSyncIfOwned = (lockPath, owner, { force = false } = {}) => {
  if (!lockPath) return false;
  try {
    if (!force) {
      const info = readLockInfoSync(lockPath);
      if (!isOwnedBy(info, owner)) return false;
    }
    fsSync.rmSync(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
};

export const removeLockFileIfOwned = async (lockPath, owner, { force = false, swallowErrors = true } = {}) => {
  if (!lockPath) return false;
  try {
    if (!force) {
      const info = await readLockInfo(lockPath);
      if (!isOwnedBy(info, owner)) return false;
    }
    await fs.rm(lockPath, { force: true });
    return true;
  } catch (err) {
    if (!swallowErrors) throw err;
    return false;
  }
};
