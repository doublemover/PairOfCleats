import { spawnSync } from 'node:child_process';
import { formatCommandFailure } from './command-failure.js';
import { isSyncCommandTimedOut, killTimedOutSyncProcessTree } from '../../src/shared/subprocess/sync-command.js';

/**
 * Run Node script via `spawnSync` with standard failure handling and owned
 * timeout cleanup. Explicit spawn options retain Node's override semantics.
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

  const resolvedSpawnOptions = {
    cwd,
    env,
    stdio,
    encoding,
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
    ...spawnOptions
  };
  // Keep raw spawnSync validation and results, including zero/undefined timeout
  // opt-outs. Only bounded commands acquire a private POSIX process group;
  // an explicit detached choice remains the caller's responsibility.
  if (resolvedSpawnOptions.detached === undefined
    && Number.isFinite(resolvedSpawnOptions.timeout)
    && resolvedSpawnOptions.timeout > 0
    && process.platform !== 'win32') {
    resolvedSpawnOptions.detached = true;
  }
  const result = spawnSync(process.execPath, args, resolvedSpawnOptions);
  if (isSyncCommandTimedOut(result)) {
    killTimedOutSyncProcessTree(result.pid, resolvedSpawnOptions.timeout, true, resolvedSpawnOptions.detached === true);
  }

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
