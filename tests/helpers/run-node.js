import { spawnSync } from 'node:child_process';

/**
 * Run Node script via `spawnSync` with standard failure handling.
 *
 * @param {string[]} args
 * @param {string} label
 * @param {string} cwd
 * @param {object} env
 * @param {{timeoutMs?:number,stdio?:any,encoding?:BufferEncoding,spawnOptions?:object,onFailure?:(result:import('node:child_process').SpawnSyncReturns<string|Buffer>)=>void}} [options]
 * @returns {import('node:child_process').SpawnSyncReturns<string|Buffer>}
 */
export const runNode = (args, label, cwd, env, options = {}) => {
  const {
    timeoutMs,
    stdio = 'inherit',
    encoding,
    allowFailure = false,
    spawnOptions = {},
    onFailure
  } = options;

  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    stdio,
    encoding,
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
    ...spawnOptions
  });

  if (result.status !== 0 && !allowFailure) {
    const details = [];
    if (result.error?.code === 'ETIMEDOUT' && Number.isFinite(timeoutMs)) {
      details.push(`timeout after ${timeoutMs}ms`);
    }
    if (result.signal) details.push(`signal ${result.signal}`);
    if (result.error && result.error.code !== 'ETIMEDOUT') {
      details.push(result.error.message || String(result.error));
    }
    const suffix = details.length ? ` (${details.join(', ')})` : '';
    console.error(`Failed: ${label}${suffix}`);
    if (typeof onFailure === 'function') onFailure(result);
    process.exit(result.status ?? 1);
  }

  return result;
};
