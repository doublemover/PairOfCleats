import { assertSampledBenchAccounting, normalizeSampledBenchOptions, runSampledBench } from './utils.js';

export const runHashBenchmark = async (backend, payload, options, { sample = runSampledBench } = {}) => {
  if (typeof backend?.hash64 !== 'function' || typeof payload !== 'string') throw new TypeError('Hash benchmark requires a backend and string payload.');
  if (!Number.isSafeInteger(Buffer.byteLength(payload, 'utf8') * normalizeSampledBenchOptions(options).iterations)) {
    throw new RangeError('Hash benchmark byte count exceeds exact accounting.');
  }
  const measurement = assertSampledBenchAccounting(await sample(() => backend.hash64(payload), options), options);
  const bytesProcessed = Buffer.byteLength(payload, 'utf8') * measurement.completedOperations;
  if (!Number.isSafeInteger(bytesProcessed)) throw new RangeError('Hash benchmark byte count exceeds exact accounting.');
  return { available: true, ...measurement, bytesProcessed,
    mbPerSec: measurement.totalMs > 0 ? bytesProcessed / (1024 * 1024) / (measurement.totalMs / 1000) : null };
};
