import { spawnSync } from 'node:child_process';

export const runNode = (args, label, cwd, env, options = {}) => {
  const {
    timeoutMs,
    stdio = 'inherit',
    encoding,
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

  if (result.status !== 0) {
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
