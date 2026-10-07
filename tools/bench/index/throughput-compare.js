export const formatThroughput = ({ items, durationMs }) => (
  durationMs > 0 ? (items / (durationMs / 1000)) : 0
);

export const printThroughputResult = (result, {
  itemLabel,
  items,
  extras = ''
} = {}) => {
  const throughput = formatThroughput({ items, durationMs: result.durationMs });
  console.log(
    `[bench] ${result.label} ${itemLabel}=${items} ms=${result.durationMs.toFixed(1)} ` +
    `throughput=${throughput.toFixed(1)}/s bytes=${result.bytes}${extras}`
  );
  return throughput;
};

export const printThroughputDelta = (baseline, current, baselineThroughput, currentThroughput) => {
  const deltaMs = current.durationMs - baseline.durationMs;
  const deltaPct = baseline.durationMs > 0 ? (deltaMs / baseline.durationMs) * 100 : 0;
  const deltaThroughput = currentThroughput - baselineThroughput;
  const deltaBytes = current.bytes - baseline.bytes;
  console.log(
    `[bench] delta ms=${deltaMs.toFixed(1)} (${deltaPct.toFixed(1)}%) ` +
    `throughput=${currentThroughput.toFixed(1)}/s Δ=${deltaThroughput.toFixed(1)}/s ` +
    `bytes=${current.bytes} Δ=${deltaBytes}`
  );
};

export const runComparedThroughputBenchmarks = async ({
  mode,
  runBaseline,
  runCurrent,
  printResult = printThroughputResult
}) => {
  let baseline = null;
  let current = null;
  let baselineThroughput = 0;
  let currentThroughput = 0;

  if (mode !== 'current') {
    baseline = await runBaseline();
    baselineThroughput = printResult(baseline);
  }

  if (mode !== 'baseline') {
    current = await runCurrent();
    currentThroughput = printResult(current);
  }

  if (baseline && current) {
    printThroughputDelta(baseline, current, baselineThroughput, currentThroughput);
  }

  return { baseline, current, baselineThroughput, currentThroughput };
};
