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
    ioConcurrencyCapConfig = null,
    defaultMultiplier = 4
  } = input;
  const cpuCount = os.cpus().length;
  const defaultFileConcurrency = Math.max(1, Math.min(cpuCount, 64));
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
  const cappedConcurrency = Math.max(1, Math.min(cpuCount, requestedConcurrency));
  const maxConcurrencyCap = Math.max(defaultFileConcurrency, cappedConcurrency);
  const fileConcurrency = Math.max(1, Math.min(maxConcurrencyCap, cappedConcurrency));
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
  const ioPlatformCap = process.platform === 'win32' ? 32 : 64;
  const ioBase = Math.max(fileConcurrency, importConcurrency);
  const configuredIoCap = Number.isFinite(Number(ioConcurrencyCapConfig)) && Number(ioConcurrencyCapConfig) > 0
    ? Math.floor(Number(ioConcurrencyCapConfig))
    : null;
  const ioDerived = Math.max(1, Math.min(ioPlatformCap, ioBase * 4));
  const ioConcurrency = configuredIoCap !== null
    ? Math.max(1, Math.min(ioDerived, configuredIoCap))
    : ioDerived;
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
