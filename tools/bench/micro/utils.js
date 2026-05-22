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

export async function runSampledBench(fn, { iterations, samples, warmup = 0 }) {
  let isAsync = false;
  for (let i = 0; i < warmup; i += 1) {
    const result = fn();
    if (isPromiseLike(result)) {
      isAsync = true;
      await result;
    }
  }

  const timings = [];
  const perSample = Math.max(1, Math.floor(iterations / samples));
  const remainder = iterations - (perSample * samples);
  let totalMs = 0;
  for (let i = 0; i < samples; i += 1) {
    const loops = perSample + (i < remainder ? 1 : 0);
    const start = process.hrtime.bigint();
    if (isAsync) {
      for (let j = 0; j < loops; j += 1) {
        await fn();
      }
    } else {
      for (let j = 0; j < loops; j += 1) {
        const result = fn();
        if (isPromiseLike(result)) {
          isAsync = true;
          await result;
          for (let k = j + 1; k < loops; k += 1) {
            await fn();
          }
          break;
        }
      }
    }
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    timings.push(elapsed);
    totalMs += elapsed;
  }
  return {
    totalMs,
    stats: summarizeDurations(timings)
  };
}

export function writeJsonWithDir(filePath, payload) {
  if (!filePath) return;
  writeJsonFileSyncResolved(filePath, payload, { finalNewline: true });
}
