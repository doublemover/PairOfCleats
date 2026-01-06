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
  const defaultThreads = Math.max(1, cpuCount * defaultMultiplier);
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
  const maxConcurrencyCap = Number.isFinite(cliConcurrency)
    ? Math.max(defaultThreads, Math.floor(cliConcurrency))
    : Number.isFinite(configConcurrency)
      ? Math.max(defaultThreads, Math.floor(configConcurrency))
      : defaultThreads;
  const defaultConcurrency = Math.max(1, Math.min(cpuCount, maxConcurrencyCap));
  const fileConcurrency = Math.max(
    1,
    Math.min(
      maxConcurrencyCap,
      Number.isFinite(cliConcurrency)
        ? cliConcurrency
        : Number.isFinite(configConcurrency)
          ? configConcurrency
          : defaultConcurrency
    )
  );
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
  const ioConcurrency = Math.max(fileConcurrency, importConcurrency) * 2;
  const cpuConcurrency = Math.max(1, Math.min(maxConcurrencyCap, fileConcurrency)) * 2;
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
