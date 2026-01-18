import fsPromises from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

export const root = process.cwd();

export async function cleanup(paths) {
  for (const dir of paths) {
    await fsPromises.rm(dir, { recursive: true, force: true });
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
