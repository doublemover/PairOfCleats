export const createPeakTracker = () => {
  let peak = process.memoryUsage().heapUsed;
  return {
    sample() {
      const used = process.memoryUsage().heapUsed;
      if (used > peak) peak = used;
    },
    getPeak() {
      return peak;
    }
  };
};

export const formatBenchResult = ({ result, fields = [], extraFields = [], baseline = null }) => {
  const peakMb = result.peakHeap / (1024 * 1024);
  const parts = [
    ...fields,
    `ms=${result.durationMs.toFixed(1)}`,
    `heapPeak=${peakMb.toFixed(1)}MB`,
    `hash=${result.hash.slice(0, 8)}`,
    ...extraFields
  ];
  if (baseline) {
    const delta = result.durationMs - baseline.durationMs;
    const pct = baseline.durationMs > 0 ? (delta / baseline.durationMs) * 100 : null;
    const memDelta = result.peakHeap - baseline.peakHeap;
    parts.push(`delta=${delta.toFixed(1)}ms (${pct?.toFixed(1)}%)`);
    parts.push(`heapΔ=${(memDelta / (1024 * 1024)).toFixed(1)}MB`);
  }
  return parts;
};

export const runCompareBench = async ({
  mode,
  runBaseline,
  runCurrent,
  formatResult
}) => {
  let baseline = null;
  if (mode !== 'current') {
    baseline = await runBaseline();
    console.log(`[bench] ${baseline.label} ${formatResult(baseline).join(' ')}`);
  }
  if (mode !== 'baseline') {
    const current = await runCurrent();
    console.log(`[bench] ${current.label} ${formatResult(current, baseline).join(' ')}`);
    if (baseline) {
      const match = baseline.hash === current.hash;
      console.log(`[bench] hash-compare match=${match}`);
    }
  }
};
