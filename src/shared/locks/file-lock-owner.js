import fs from 'node:fs/promises';
import { runSyncCommandWithTimeout, toSyncCommandExitCode } from '../subprocess/sync-command.js';
import { DEFAULT_WINDOWS_TASKLIST_TIMEOUT_MS } from './file-lock-constants.js';
import { readLockInfo, resolveLockPid, isOwnedBy, requiresLockResourceSettlement } from './file-lock-info.js';
import { isFileLockPublicationPending } from './file-lock-publication.js';
export { isOwnedBy, removeLockFileSyncIfOwned } from './file-lock-info.js';

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

export const removeLockFileIfOwned = async (lockPath, owner, { force = false, swallowErrors = true } = {}) => {
  if (!lockPath || isFileLockPublicationPending(lockPath)) return false;
  try {
    const info = await readLockInfo(lockPath);
    if ((!force || requiresLockResourceSettlement(info)) && !isOwnedBy(info, owner)) return false;
    await fs.rm(lockPath, { force: true });
    return true;
  } catch (err) {
    if (!swallowErrors) throw err;
    return false;
  }
};
