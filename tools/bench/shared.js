import { createCli } from '../../src/shared/cli.js';

export const parseBenchArgs = (rawArgs = process.argv.slice(2), { scriptName = 'bench' } = {}) => createCli({
  scriptName,
  argv: ['node', scriptName, ...(Array.isArray(rawArgs) ? rawArgs : [])]
}).parseSync();

export const parseSimpleBenchArgs = (rawArgs = process.argv.slice(2)) => {
  const out = {};
  const argv = Array.isArray(rawArgs) ? rawArgs : [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
};

export const resolveCompareMode = (value) => {
  const mode = String(value).toLowerCase();
  return ['baseline', 'current', 'compare'].includes(mode) ? mode : 'compare';
};

export const percentile = (values, pct) => {
  if (!Array.isArray(values) || !values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * pct)));
  return sorted[idx];
};

export const createSeededRng = (seed) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

export const pickRandom = (rng, list) => list[Math.floor(rng() * list.length)];
