#!/usr/bin/env node
import { createCli } from '../../../src/shared/cli.js';
import { isDirectExecution } from '../../../src/shared/direct-execution.js';
import { renderGraphContextPack } from '../../../src/retrieval/output/graph-context-pack.js';
import {
  normalizeCompareMode,
  printBaselineCurrentSummary,
  readNumberArg,
  runTimedIterations
} from './shared.js';

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
  const normalizedMode = normalizeCompareMode(mode);
  const results = {};

  if (normalizedMode === 'baseline' || normalizedMode === 'compare') {
    results.baseline = runTimedIterations({
      iterations,
      run: () => renderGraphContextPack({ ...pack, stats: { sorted: false } })
    });
  }

  if (normalizedMode === 'current' || normalizedMode === 'compare') {
    results.current = runTimedIterations({
      iterations,
      run: () => renderGraphContextPack({ ...pack, stats: { sorted: true } })
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
  const size = readNumberArg(argv.size, 2000);
  const iterations = readNumberArg(argv.iterations, 5);
  const mode = argv.mode || 'compare';

  const result = await runRenderSortBench({ size, iterations, mode });

  printBaselineCurrentSummary(result);

  console.log(JSON.stringify({ ok: true, result }, null, 2));
  return result;
}

if (isDirectExecution(import.meta.url)) {
  runRenderSortBenchCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
