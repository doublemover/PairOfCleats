import os from 'node:os';

/**
 * Resolve thread and queue concurrency limits used by indexing runtime stages.
 *
 * Resolution precedence is `--threads` (CLI) -> `config.indexing.concurrency`
 * -> `PAIROFCLEATS_THREADS` -> computed default.
 *
 * Explicit CLI overcommit (`--threads` greater than detected CPU threads) is
 * treated as intentional up to a bounded ceiling (`2x` detected CPU threads);
 * in that case IO oversubscription is also enabled so file/import/io limits are
 * not silently clamped back down below the effective thread request.
 *
 * @param {object} [input]
 * @param {object} [input.argv]
 * @param {string[]} [input.rawArgv]
 * @param {{threads?:number|string}} [input.envConfig]
 * @param {number|null} [input.configConcurrency]
 * @param {string} [input.configConcurrencySource]
 * @param {string} [input.configSourceTag]
 * @param {number|null} [input.importConcurrencyConfig]
 * @param {number|null} [input.ioConcurrencyCapConfig]
 * @param {number} [input.defaultMultiplier]
 * @param {number} [input.cpuCount]
 * @param {number} [input.totalMemBytes]
 * @param {number|null} [input.uvThreadpoolSize]
 * @param {boolean} [input.ioOversubscribe]
 * @returns {{
 *   cpuCount:number,
 *   totalMemBytes:number,
 *   totalMemGiB:number|null,
 *   defaultThreads:number,
 *   maxConcurrencyCap:number,
 *   threads:number,
 *   fileConcurrency:number,
 *   importConcurrency:number,
 *   ioConcurrency:number,
 *   cpuConcurrency:number,
 *   procConcurrency:number,
 *   source:string,
 *   sourceDetail:string
 * }}
 */
export function resolveThreadLimits(input = {}) {
  const {
    argv = {},
    rawArgv = [],
    envConfig = {},
    configConcurrency = null,
    configConcurrencySource = 'config.indexing.concurrency',
    configSourceTag = 'config',
    importConcurrencyConfig = null,
    ioConcurrencyCapConfig = null,
    defaultMultiplier = 4,
    cpuCount: cpuCountInput,
    totalMemBytes: totalMemBytesInput,
    uvThreadpoolSize = null,
    ioOversubscribe = false
  } = input;
  const cpuCount = Number.isFinite(cpuCountInput) && cpuCountInput > 0 ? Math.floor(cpuCountInput) : os.cpus().length;
  const totalMemBytes = Number.isFinite(totalMemBytesInput) && totalMemBytesInput > 0
    ? totalMemBytesInput
    : os.totalmem();
  const totalMemGiB = Number.isFinite(totalMemBytes) && totalMemBytes > 0
    ? totalMemBytes / (1024 ** 3)
    : null;
  const defaultFileConcurrency = Math.max(1, Math.min(cpuCount, 64));
  const defaultThreads = Math.max(1, defaultFileConcurrency * defaultMultiplier);
  const rawCliThreads = Number(argv.threads);
  const envThreads = Number(envConfig.threads);
  const threadsArgPresent = Array.isArray(rawArgv)
    && rawArgv.some((arg) => arg === '--threads' || String(arg).startsWith('--threads='));
  const envThreadsProvided = Number.isFinite(envThreads) && envThreads > 0;
  const cliThreadsProvided = threadsArgPresent && Number.isFinite(rawCliThreads) && rawCliThreads > 0;
  const configThreadsProvided = Number.isFinite(configConcurrency) && configConcurrency > 0;
  const requestedThreads = cliThreadsProvided
    ? Math.floor(rawCliThreads)
    : configThreadsProvided
      ? Math.floor(configConcurrency)
      : envThreadsProvided
        ? Math.floor(envThreads)
        : defaultThreads;
  const cliOvercommitCap = Math.max(1, cpuCount * 2);
  const effectiveCliThreads = cliThreadsProvided
    ? Math.min(Math.max(1, requestedThreads), cliOvercommitCap)
    : requestedThreads;
  const explicitCliOvercommit = cliThreadsProvided && effectiveCliThreads > cpuCount;
  const resolvedThreads = cliThreadsProvided
    ? Math.max(1, effectiveCliThreads)
    : Math.max(1, Math.min(cpuCount, requestedThreads));
  const effectiveIoOversubscribe = ioOversubscribe || explicitCliOvercommit;
  const maxConcurrencyCap = Math.max(defaultFileConcurrency, resolvedThreads);
  const maxFileConcurrencyCap = Math.max(defaultFileConcurrency, resolvedThreads * 2);
  let fileConcurrency = Math.max(1, Math.min(maxFileConcurrencyCap, resolvedThreads * 2));
  let importConcurrency = Math.max(
    1,
    Math.min(
      maxFileConcurrencyCap,
      cliThreadsProvided
        ? fileConcurrency
        : Number.isFinite(Number(importConcurrencyConfig))
          ? Number(importConcurrencyConfig)
          : fileConcurrency
    )
  );
  const ioPlatformCap = 64;
  const ioMemoryCap = Number.isFinite(totalMemGiB)
    ? totalMemGiB >= 32
      ? 64
      : totalMemGiB >= 16
        ? 32
        : 16
    : ioPlatformCap;
  const effectiveUv = Number.isFinite(Number(uvThreadpoolSize)) && uvThreadpoolSize > 0
    ? Math.floor(uvThreadpoolSize)
    : 4;
  const ioDefaultCap = Math.min(
    ioPlatformCap,
    Math.max(1, effectiveUv * 4),
    effectiveIoOversubscribe ? ioPlatformCap : ioMemoryCap
  );
  if (!effectiveIoOversubscribe) {
    fileConcurrency = Math.min(fileConcurrency, ioDefaultCap);
    importConcurrency = Math.min(importConcurrency, ioDefaultCap);
  }
  const ioBase = Math.max(fileConcurrency, importConcurrency);
  const configuredIoCap = Number.isFinite(Number(ioConcurrencyCapConfig)) && Number(ioConcurrencyCapConfig) > 0
    ? Math.floor(Number(ioConcurrencyCapConfig))
    : null;
  let ioConcurrency = effectiveIoOversubscribe
    ? Math.max(1, Math.min(ioPlatformCap, ioBase))
    : Math.max(1, Math.min(ioPlatformCap, ioDefaultCap));
  if (configuredIoCap !== null) {
    ioConcurrency = Math.max(1, Math.min(ioConcurrency, configuredIoCap));
  }
  const cpuConcurrency = Math.max(1, Math.min(maxConcurrencyCap, resolvedThreads));
  const procConcurrency = Math.max(1, Math.min(32, resolvedThreads));
  const source = cliThreadsProvided
    ? 'cli'
    : configThreadsProvided
      ? (configSourceTag || 'config')
      : envThreadsProvided
        ? 'env'
        : 'default';
  const sourceDetail = cliThreadsProvided
    ? '--threads'
    : configThreadsProvided
      ? configConcurrencySource
      : envThreadsProvided
        ? 'PAIROFCLEATS_THREADS'
        : 'default';
  return {
    cpuCount,
    totalMemBytes,
    totalMemGiB,
    defaultThreads,
    maxConcurrencyCap,
    threads: resolvedThreads,
    fileConcurrency,
    importConcurrency,
    ioConcurrency,
    cpuConcurrency,
    procConcurrency,
    source,
    sourceDetail
  };
}
