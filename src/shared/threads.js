import os from 'node:os';

/**
 * Resolve thread limits and concurrency defaults.
 * @param {object} input
 * @returns {object}
 */
export function resolveThreadLimits(input = {}) {
  const {
    argv = {},
    rawArgv = [],
    envConfig = {},
    configConcurrency = null,
    importConcurrencyConfig = null,
    defaultMultiplier = 4
  } = input;
  const cpuCount = os.cpus().length;
  const isWindows = process.platform === 'win32';
  const defaultFileConcurrency = Math.max(
    1,
    Math.min(cpuCount, isWindows ? 8 : 16)
  );
  const defaultThreads = Math.max(1, defaultFileConcurrency * defaultMultiplier);
  const rawCliThreads = Number(argv.threads);
  const envThreads = Number(envConfig.threads);
  const threadsArgPresent = Array.isArray(rawArgv)
    && rawArgv.some((arg) => arg === '--threads' || String(arg).startsWith('--threads='));
  const envThreadsProvided = Number.isFinite(envThreads) && envThreads > 0;
  const cliThreadsProvided = threadsArgPresent
    || (Number.isFinite(rawCliThreads) && rawCliThreads !== defaultThreads);
  const cliConcurrency = envThreadsProvided
    ? envThreads
    : (cliThreadsProvided ? rawCliThreads : null);
  const requestedConcurrency = Number.isFinite(cliConcurrency)
    ? Math.floor(cliConcurrency)
    : Number.isFinite(configConcurrency)
      ? Math.floor(configConcurrency)
      : defaultFileConcurrency;
  const maxConcurrencyCap = Math.max(defaultFileConcurrency, requestedConcurrency);
  const fileConcurrency = Math.max(1, Math.min(maxConcurrencyCap, requestedConcurrency));
  const importConcurrency = Math.max(
    1,
    Math.min(
      maxConcurrencyCap,
      Number.isFinite(cliConcurrency)
        ? fileConcurrency
        : Number.isFinite(Number(importConcurrencyConfig))
          ? Number(importConcurrencyConfig)
          : fileConcurrency
    )
  );
  const ioCap = isWindows ? 32 : 64;
  const ioBase = Math.max(fileConcurrency, importConcurrency);
  const ioConcurrency = Math.max(1, Math.min(ioCap, ioBase * 4));
  const cpuConcurrency = Math.max(1, Math.min(maxConcurrencyCap, fileConcurrency));
  const source = envThreadsProvided
    ? 'env'
    : cliThreadsProvided
      ? 'cli'
      : Number.isFinite(configConcurrency)
        ? 'config'
        : 'default';
  return {
    cpuCount,
    defaultThreads,
    maxConcurrencyCap,
    fileConcurrency,
    importConcurrency,
    ioConcurrency,
    cpuConcurrency,
    source
  };
}
