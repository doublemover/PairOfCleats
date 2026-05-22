#!/usr/bin/env node
import {
  formatHeapDeltaMb,
  parseBenchArgs,
  prepareBenchRoot,
  resolveCompareMode,
  runPostingsBenchOnce
} from './shared-postings-bench.js';

const args = parseBenchArgs();
const vocabSize = Number(args.vocab) || 250000;
const docs = Number(args.docs) || 50000;
const postingsPerToken = Number(args.postings) || 3;
const spillThreshold = Number(args.spill) || 100000;
const samples = Math.max(1, Math.floor(Number(args.samples) || 3));
const enableRollingHash = args.rolling === true || args['rolling-hash'] === true;
const mode = resolveCompareMode(args.mode);

const benchRoot = await prepareBenchRoot('chargram-postings');

const MASK_64 = (1n << 64n) - 1n;
const MIX_CONST = 0x9e3779b97f4a7c15n;

const formatH64 = (value) => {
  const normalized = (value & MASK_64).toString(16);
  return normalized.length >= 16 ? normalized.slice(-16) : normalized.padStart(16, '0');
};

const buildChargramKey = (i) => {
  if (enableRollingHash) {
    const mixed = (BigInt(i) * MIX_CONST) & MASK_64;
    return `h64:${formatH64(mixed)}`;
  }
  return i.toString(36).padStart(4, '0');
};

const runOnce = (label, spillMaxUnique, sampleIndex = 0) => runPostingsBenchOnce({
  benchRoot,
  label: samples > 1 ? `${label}-sample-${sampleIndex}` : label,
  spillMaxUnique,
  vocabSize,
  docs,
  postingsPerToken,
  tokenForIndex: buildChargramKey,
  resultExtra: () => ({
    algorithm: enableRollingHash ? 'rolling-hash' : 'substring'
  })
});

const runBest = async (label, spillMaxUnique) => {
  let best = null;
  for (let sample = 0; sample < samples; sample += 1) {
    const result = await runOnce(label, spillMaxUnique, sample);
    if (!best || result.durationMs < best.durationMs) {
      best = {
        ...result,
        label,
        sample
      };
    }
  }
  return {
    ...best,
    samples
  };
};

const formatStats = (label, stats) => {
  if (!stats) return `${label} stats=none`;
  const parts = [
    `spill=${stats.spillEnabled ? 'on' : 'off'}`,
    `runs=${stats.spillRuns || 0}`,
    `rows=${stats.spillRows || 0}`,
    `bytes=${stats.spillBytes || 0}`
  ];
  return `${label} ${parts.join(' ')}`;
};

const printResult = (result, baseline = null) => {
  const parts = [
    `algo=${result.algorithm}`,
    `ms=${result.durationMs.toFixed(1)}`,
    `heapΔ=${formatHeapDeltaMb(result.heapDelta)}MB`,
    `vocab=${result.vocab}`,
    `sample=${(result.sample ?? 0) + 1}/${result.samples || 1}`
  ];
  if (baseline) {
    const delta = result.durationMs - baseline.durationMs;
    const pct = baseline.durationMs > 0 ? (delta / baseline.durationMs) * 100 : null;
    parts.push(`delta=${delta.toFixed(1)}ms (${pct?.toFixed(1)}%)`);
  }
  console.log(`[bench] ${result.label} ${parts.join(' ')} | ${formatStats('chargram', result.stats)}`);
};

let baseline = null;
let current = null;

if (mode !== 'current') {
  baseline = await runBest('baseline', 0);
  printResult(baseline);
}

if (mode !== 'baseline') {
  current = await runBest('current', spillThreshold);
  printResult(current, baseline);
}

if (baseline && current) {
  const deltaMs = current.durationMs - baseline.durationMs;
  const pct = baseline.durationMs > 0 ? (deltaMs / baseline.durationMs) * 100 : 0;
  console.log(`[bench] delta ms=${deltaMs.toFixed(1)} (${pct.toFixed(1)}%)`);
}

const summary = {
  generatedAt: new Date().toISOString(),
  algo: enableRollingHash ? 'rolling-hash' : 'substring',
  vocabSize,
  docs,
  postingsPerToken,
  spillThreshold,
  samples,
  baseline,
  current
};
console.log(JSON.stringify(summary, null, 2));
