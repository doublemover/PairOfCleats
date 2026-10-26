import { build as buildHistogram } from 'hdr-histogram-js';
import { writeJsonFileSyncResolved } from '../../../src/shared/json-file.js';

const buildLatencyHistogram = (values) => {
  if (!values.length) return null;
  const scaled = values.map((value) => Math.max(1, Math.round(value * 1000)));
  const maxValue = Math.max(...scaled, 1);
  const histogram = buildHistogram({
    lowestDiscernibleValue: 1,
    highestTrackableValue: maxValue,
    numberOfSignificantValueDigits: 3
  });
  scaled.forEach((value) => histogram.recordValue(value));
  return histogram;
};

export function summarizeDurations(values) {
  if (!values.length) {
    return { count: 0, mean: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const histogram = buildLatencyHistogram(values);
  const pct = (p) => (histogram ? histogram.getValueAtPercentile(p) / 1000 : 0);
  return {
    count: values.length,
    mean: total / values.length,
    min,
    max,
    p50: pct(50),
    p95: pct(95),
    p99: pct(99)
  };
}

export function formatMs(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${value.toFixed(1)}ms`;
}

export function formatStats(stats) {
  return `mean ${formatMs(stats.mean)} | p50 ${formatMs(stats.p50)} | p95 ${formatMs(stats.p95)} | p99 ${formatMs(stats.p99)} | min ${formatMs(stats.min)} | max ${formatMs(stats.max)} | n=${stats.count}`;
}

export function hrtimeMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

const isPromiseLike = (value) => value && typeof value.then === 'function';

export const normalizeSampledBenchOptions = ({ iterations, samples, warmup = 0 }) => {
  for (const [name, value, minimum] of [['iterations', iterations, 1], ['samples', samples, 1], ['warmup', warmup, 0]]) {
    if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`Invalid sampled benchmark ${name}.`);
  }
  if (!Number.isSafeInteger(iterations + warmup)) throw new RangeError('Benchmark operation count exceeds exact integer accounting.');
  return { iterations, requestedSamples: samples, samples: Math.min(iterations, samples), warmup };
};

export const assertSampledBenchAccounting = (result, input) => {
  const options = normalizeSampledBenchOptions(input);
  if (result?.requestedIterations !== options.iterations || result.completedOperations !== options.iterations || result.warmupOperations !== options.warmup
    || result.requestedSamples !== options.requestedSamples || result.effectiveSamples !== options.samples
    || !Array.isArray(result.bucketOperations) || result.bucketOperations.length !== options.samples
    || result.bucketOperations.some(count => !Number.isSafeInteger(count) || count <= 0)
    || result.bucketOperations.reduce((sum, value) => sum + value, 0) !== result.completedOperations
    || !Array.isArray(result.timings) || result.timings.length !== options.samples
    || result.timings.some(ms => !Number.isFinite(ms) || ms < 0) || !Number.isFinite(result.totalMs) || result.totalMs < 0
    || !Number.isFinite(result.warmupMs) || result.warmupMs < 0 || result.statsUnit !== 'milliseconds-per-bucket'
    || result.stats?.count !== options.samples) {
    throw Object.assign(new Error('Sampled benchmark completed-work receipt is inconsistent.'), { code: 'ERR_BENCH_MEASURED_WORK' });
  }
  return result;
};

export async function runSampledBench(fn, input, { nowNs = () => process.hrtime.bigint() } = {}) {
  const { iterations, samples, requestedSamples, warmup } = normalizeSampledBenchOptions(input);
  if (typeof fn !== 'function') throw new TypeError('A benchmark operation is required.');
  let isAsync = false;
  const warmupStart = warmup ? nowNs() : null;
  for (let i = 0; i < warmup; i += 1) {
    const result = fn();
    if (isPromiseLike(result)) {
      isAsync = true;
      await result;
    }
  }
  const warmupMs = warmup ? Number(nowNs() - warmupStart) / 1e6 : 0;

  const timings = [], bucketOperations = [];
  let completedOperations = 0;
  const perSample = Math.floor(iterations / samples);
  const remainder = iterations - (perSample * samples);
  let totalMs = 0;
  for (let i = 0; i < samples; i += 1) {
    const loops = perSample + (i < remainder ? 1 : 0);
    const start = nowNs();
    if (isAsync) {
      for (let j = 0; j < loops; j += 1) {
        await fn();
        completedOperations++;
      }
    } else {
      for (let j = 0; j < loops; j += 1) {
        const result = fn();
        if (isPromiseLike(result)) {
          isAsync = true;
          await result;
          completedOperations++;
          for (let k = j + 1; k < loops; k += 1) {
            await fn();
            completedOperations++;
          }
          break;
        }
        completedOperations++;
      }
    }
    const elapsed = Number(nowNs() - start) / 1e6;
    timings.push(elapsed);
    bucketOperations.push(loops);
    totalMs += elapsed;
  }
  return {
    schemaVersion: 2, requestedIterations: iterations, requestedSamples, effectiveSamples: samples,
    completedOperations, warmupOperations: warmup, warmupMs, bucketOperations, statsUnit: 'milliseconds-per-bucket',
    totalMs,
    timings,
    stats: summarizeDurations(timings)
  };
}

export function writeJsonWithDir(filePath, payload) {
  if (!filePath) return;
  writeJsonFileSyncResolved(filePath, payload, { finalNewline: true });
}
