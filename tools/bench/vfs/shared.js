import { formatStats, summarizeDurations } from '../micro/utils.js';

export function clampInt(value, min, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

export function clampFloat(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function createRng(seedValue) {
  let state = (seedValue >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function randomAlphaText(length, rng) {
  const chars = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const code = 97 + Math.floor(rng() * 26);
    chars[i] = String.fromCharCode(code);
  }
  return chars.join('');
}

export function buildLookupIndices(count, max, seedValue) {
  const rng = createRng(seedValue);
  const indices = new Array(count);
  for (let i = 0; i < count; i += 1) {
    indices[i] = Math.floor(rng() * max);
  }
  return indices;
}

export function runSampled({ iterations, samples, fn }) {
  const timings = [];
  const perSample = Math.max(1, Math.floor(iterations / samples));
  const remainder = iterations - perSample * samples;
  let totalMs = 0;
  let index = 0;
  for (let i = 0; i < samples; i += 1) {
    const loops = perSample + (i < remainder ? 1 : 0);
    const start = process.hrtime.bigint();
    for (let j = 0; j < loops; j += 1) {
      fn(index);
      index += 1;
    }
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    timings.push(elapsed);
    totalMs += elapsed;
  }
  const stats = summarizeDurations(timings);
  const opsPerSec = totalMs > 0 ? iterations / (totalMs / 1000) : 0;
  return { totalMs, opsPerSec, stats };
}

export function printBench(label, bench) {
  const stats = bench.stats ? formatStats(bench.stats) : 'n/a';
  const ops = Number.isFinite(bench.opsPerSec) ? bench.opsPerSec.toFixed(1) : 'n/a';
  console.error(`- ${label}: ${stats} | ops/sec ${ops}`);
}
