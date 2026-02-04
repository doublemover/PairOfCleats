#!/usr/bin/env node
import { createCli } from '../../../src/shared/cli.js';
import { normalizeOptionalNumber } from '../../../src/shared/limits.js';
import { renderGraphContextPack } from '../../../src/retrieval/output/graph-context-pack.js';

const summarize = (values) => {
  if (!values.length) return { min: 0, max: 0, avg: 0 };
  const sorted = values.slice().sort((a, b) => a - b);
  const sum = values.reduce((acc, value) => acc + value, 0);
  const percentile = (p) => {
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p)));
    return sorted[idx];
  };
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / values.length,
    p50: percentile(0.5),
    p95: percentile(0.95)
  };
};

const runIterations = ({ iterations, render }) => {
  const timings = [];
  let durationMs = 0;
  for (let i = 0; i < iterations; i += 1) {
    const started = process.hrtime.bigint();
    const result = render();
    void result;
    const elapsed = Number((process.hrtime.bigint() - started) / 1000000n);
    timings.push(elapsed);
    durationMs += elapsed;
  }
  const throughput = durationMs > 0 ? iterations / (durationMs / 1000) : 0;
  return {
    iterations,
    timingMs: summarize(timings),
    totalMs: durationMs,
    throughput
  };
};

const buildSyntheticPack = (size) => {
  const nodes = [];
  const edges = [];
  for (let i = 0; i < size; i += 1) {
    nodes.push({
      ref: { type: 'chunk', chunkUid: `chunk-${size - i}` },
      distance: size - i
    });
    if (i > 0) {
      edges.push({
        from: { type: 'chunk', chunkUid: `chunk-${size - i}` },
        to: { type: 'chunk', chunkUid: `chunk-${size - i + 1}` },
        edgeType: 'call',
        graph: 'callGraph'
      });
    }
  }
  return {
    seed: { type: 'chunk', chunkUid: 'chunk-0' },
    nodes,
    edges,
    stats: { sorted: false }
  };
};

export async function runRenderSortBench({ size, iterations, mode }) {
  const pack = buildSyntheticPack(size);
  const normalizedMode = mode === 'baseline' || mode === 'current' ? mode : 'compare';
  const results = {};

  if (normalizedMode === 'baseline' || normalizedMode === 'compare') {
    results.baseline = runIterations({
      iterations,
      render: () => renderGraphContextPack({ ...pack, stats: { sorted: false } })
    });
  }

  if (normalizedMode === 'current' || normalizedMode === 'compare') {
    results.current = runIterations({
      iterations,
      render: () => renderGraphContextPack({ ...pack, stats: { sorted: true } })
    });
  }

  return { mode: normalizedMode, ...results };
}

export async function runRenderSortBenchCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'graph-render-sort-bench',
    argv: ['node', 'graph-render-sort-bench', ...rawArgs],
    options: {
      size: { type: 'number', default: 2000 },
      iterations: { type: 'number', default: 5 },
      mode: { type: 'string', default: 'compare' }
    }
  });
  const argv = cli.parse();
  const size = normalizeOptionalNumber(argv.size) || 2000;
  const iterations = normalizeOptionalNumber(argv.iterations) || 5;
  const mode = argv.mode || 'compare';

  const result = await runRenderSortBench({ size, iterations, mode });

  const formatSummary = (label, summary) => {
    const avg = summary.timingMs.avg.toFixed(2);
    const p95 = summary.timingMs.p95.toFixed(2);
    const total = summary.totalMs.toFixed(1);
    const throughput = summary.throughput.toFixed(2);
    console.log(`[bench] ${label} total=${total}ms avg=${avg}ms p95=${p95}ms throughput=${throughput} it/s`);
  };

  if (result.baseline) formatSummary('baseline', result.baseline);
  if (result.current) formatSummary('current', result.current);
  if (result.baseline && result.current) {
    const deltaMs = result.current.totalMs - result.baseline.totalMs;
    const deltaPct = result.baseline.totalMs ? (deltaMs / result.baseline.totalMs) * 100 : 0;
    const deltaThroughput = result.current.throughput - result.baseline.throughput;
    console.log(
      `[bench] delta ms=${deltaMs.toFixed(1)} throughput=${deltaThroughput.toFixed(2)} it/s ` +
      `pct=${deltaPct.toFixed(1)} duration=${result.current.totalMs.toFixed(1)}ms`
    );
  }

  console.log(JSON.stringify({ ok: true, result }, null, 2));
  return result;
}

if (process.argv[1] && process.argv[1].endsWith('render-sort.js')) {
  runRenderSortBenchCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
