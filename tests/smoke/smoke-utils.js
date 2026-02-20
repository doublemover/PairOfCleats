import { spawnSync } from 'node:child_process';
import { RETRYABLE_RM_CODES, rmDirRecursive } from '../helpers/temp.js';

export const root = process.cwd();

export async function cleanup(paths) {
  for (const dir of paths) {
    try {
      const removed = await rmDirRecursive(dir, {
        retries: 10,
        delayMs: 100,
        ignoreRetryableFailure: true
      });
      if (!removed) {
        console.warn(`Cleanup warning (ignored): retryable failure while removing ${dir}`);
      }
    } catch (err) {
      if (RETRYABLE_RM_CODES.has(err?.code)) {
        console.warn(`Cleanup warning (ignored): ${err.code} while removing ${dir}`);
        continue;
      }
      throw err;
    }
  }
}

export function runNode(label, scriptPath, args = [], options = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    ...options
  });
  if (result.status !== 0) {
    const error = new Error(`Failed: ${label}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
  return result;
}
