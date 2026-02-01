import fsPromises from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

export const root = process.cwd();

const RETRYABLE_RM_CODES = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM', 'EACCES']);
const MAX_RM_ATTEMPTS = 10;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function cleanup(paths) {
  for (const dir of paths) {
    let lastError = null;
    for (let attempt = 0; attempt < MAX_RM_ATTEMPTS; attempt += 1) {
      try {
        await fsPromises.rm(dir, { recursive: true, force: true });
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        if (!RETRYABLE_RM_CODES.has(err?.code)) break;
        await sleep(100 * (attempt + 1));
      }
    }
    if (lastError) {
      if (RETRYABLE_RM_CODES.has(lastError?.code)) {
        console.warn(`Cleanup warning (ignored): ${lastError.code} while removing ${dir}`);
        continue;
      }
      throw lastError;
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
