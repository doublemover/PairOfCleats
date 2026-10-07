#!/usr/bin/env node
import {
  calculateThroughput,
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
const mode = resolveCompareMode(args.mode);

const benchRoot = await prepareBenchRoot('postings-guard');

const buildGuardKey = (i) => `cg-${i.toString(36)}`;

const runOnce = (label, spillMaxUnique) => runPostingsBenchOnce({
  benchRoot,
  label,
  spillMaxUnique,
  vocabSize,
  docs,
  postingsPerToken,
  tokenForIndex: buildGuardKey
});

const formatStats = (stats) => {
  if (!stats) return 'spill=unknown';
  return `spill=${stats.spillEnabled ? 'on' : 'off'} runs=${stats.spillRuns || 0} bytes=${stats.spillBytes || 0}`;
};

const printResult = (result) => {
  const tp = calculateThroughput(vocabSize, result.durationMs);
  console.log(
    `[bench] ${result.label} vocab=${result.vocab} ms=${result.durationMs.toFixed(1)} ` +
    `throughput=${tp.toFixed(1)}/s heapΔ=${formatHeapDeltaMb(result.heapDelta)}MB ` +
    `${formatStats(result.stats)}`
  );
  return tp;
};

const printDelta = (baseline, current, baseTp, curTp) => {
  const deltaMs = current.durationMs - baseline.durationMs;
  const deltaPct = baseline.durationMs > 0 ? (deltaMs / baseline.durationMs) * 100 : 0;
  const deltaTp = curTp - baseTp;
  console.log(
    `[bench] delta ms=${deltaMs.toFixed(1)} (${deltaPct.toFixed(1)}%) ` +
    `throughput=${curTp.toFixed(1)}/s Δ=${deltaTp.toFixed(1)}/s ` +
    `heapΔ=${formatHeapDeltaMb(current.heapDelta - baseline.heapDelta)}MB`
  );
};

let baseline = null;
let current = null;
let baseTp = 0;
let curTp = 0;

if (mode !== 'current') {
  baseline = await runOnce('baseline', 0);
  baseTp = printResult(baseline);
}

if (mode !== 'baseline') {
  current = await runOnce('current', spillThreshold);
  curTp = printResult(current);
}

if (baseline && current) {
  printDelta(baseline, current, baseTp, curTp);
}
