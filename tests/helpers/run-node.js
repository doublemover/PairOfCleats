import { spawnSync } from 'node:child_process';
import { formatCommandFailure } from './command-failure.js';

/**
 * Run Node script via `spawnSync` with standard failure handling.
 *
 * @param {string[]} args
 * @param {string} label
 * @param {string} cwd
 * @param {object} env
 * @param {{timeoutMs?:number,stdio?:any,encoding?:BufferEncoding|'buffer',spawnOptions?:object,onFailure?:(result:import('node:child_process').SpawnSyncReturns<string|Buffer>)=>void}} [options]
 * @returns {import('node:child_process').SpawnSyncReturns<string|Buffer>}
 */
export const runNode = (args, label, cwd, env, options = {}) => {
  const {
    timeoutMs,
    stdio = 'inherit',
    encoding = 'utf8',
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
    const timeoutHint = result.error?.code === 'ETIMEDOUT' && Number.isFinite(timeoutMs)
      ? `timeout after ${timeoutMs}ms`
      : '';
    const resolvedLabel = timeoutHint ? `${label} (${timeoutHint})` : label;
    console.error(formatCommandFailure({
      label: resolvedLabel,
      command: `${process.execPath} ${Array.isArray(args) ? args.join(' ') : ''}`.trim(),
      cwd,
      result
    }));
    if (typeof onFailure === 'function') onFailure(result);
    process.exit(result.status ?? 1);
  }

  return result;
};
