import fs from 'node:fs/promises';
import { throwIfAborted } from '../../../shared/abort.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitForStableFile = async (absPath, { checks, intervalMs, signal,
  throwOnObservationError = false, statPath = file => fs.stat(file) }) => {
  const requiredChecks = Number.isFinite(Number(checks)) ? Math.max(1, Math.floor(Number(checks))) : 1;
  const resolvedInterval = Number.isFinite(Number(intervalMs)) ? Math.max(0, Math.floor(Number(intervalMs))) : 0;
  const maxAttempts = Math.max(requiredChecks, requiredChecks * 3);
  let lastSignature = null;
  let stableCount = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    throwIfAborted(signal);
    let stat = null;
    try {
      stat = await statPath(absPath);
    } catch (error) {
      if (throwOnObservationError) throw error;
      return false;
    }
    throwIfAborted(signal);
    const signature = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${Number(stat.ino || 0)}`;
    if (signature === lastSignature) {
      stableCount += 1;
    } else {
      lastSignature = signature;
      stableCount = 1;
    }
    if (stableCount >= requiredChecks) return true;
    if (attempt < maxAttempts - 1) {
      await sleep(resolvedInterval);
    }
  }
  return false;
};
