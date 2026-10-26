#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const { createCli } = await import('../../../src/shared/cli.js');
const { isDirectExecution } = await import('../../../src/shared/direct-execution.js');
const { renderGraphContextPack } = await import('../../../src/retrieval/output/graph-context-pack.js');
const { compareGraphNodes, compareGraphEdges, compareWitnessPaths } = await import('../../../src/graph/ordering.js');
const { createHash } = await import('node:crypto');
const {
  normalizeCompareMode,
  printBaselineCurrentSummary,
  readNumberArg,
  runTimedIterations
} = await import('./shared.js');

const buildSyntheticPack = (size) => {
  const nodes = [];
  const edges = [];
  const paths = [];
  for (let i = 0; i < size; i += 1) {
    nodes.push({
      ref: { type: 'chunk', chunkUid: `chunk-${i}` },
      distance: i === 0 ? 0 : 1
    });
    if (i > 0) {
      edges.push({
        from: { type: 'chunk', chunkUid: 'chunk-0' },
        to: { type: 'chunk', chunkUid: `chunk-${i}` },
        edgeType: ['call', 'usage', 'import'][i % 3],
        graph: ['callGraph', 'usageGraph', 'importGraph'][i % 3]
      });
      paths.push({ to: { type: 'chunk', chunkUid: `chunk-${i}` }, distance: 1,
        nodes: [{ type: 'chunk', chunkUid: 'chunk-0' }, { type: 'chunk', chunkUid: `chunk-${i}` }] });
      if (i % 7 === 0) edges.push({ ...edges.at(-1), edgeType: 'reference', graph: 'usageGraph' });
    }
  }
  return {
    seed: { type: 'chunk', chunkUid: 'chunk-0' },
    nodes: nodes.reverse(),
    edges: edges.reverse(),
    paths: paths.reverse(),
    stats: { sorted: false }
  };
};

export async function runRenderSortBench({ size, iterations, mode }, { render = renderGraphContextPack } = {}) {
  if (!Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(iterations) || iterations < 1) {
    throw new RangeError('Render-sort benchmark requires positive integral size and iterations.');
  }
  const preparationStart = process.hrtime.bigint();
  const shuffled = buildSyntheticPack(size);
  const pack = { ...shuffled, nodes: shuffled.nodes.toSorted(compareGraphNodes),
    edges: shuffled.edges.toSorted(compareGraphEdges), paths: shuffled.paths.toSorted(compareWitnessPaths) };
  const preparationMs = Number(process.hrtime.bigint() - preparationStart) / 1e6;
  const baselinePack = { ...pack, stats: { sorted: false } }, currentPack = { ...pack, stats: { sorted: true } };
  const baselineOutput = render(baselinePack), currentOutput = render(currentPack);
  if (baselineOutput !== currentOutput || currentOutput !== render(shuffled)) {
    throw Object.assign(new Error('Render-sort arms must produce byte-identical canonical output.'), { code: 'ERR_BENCH_GRAPH_RENDER_PARITY' });
  }
  const normalizedMode = normalizeCompareMode(mode);
  const results = {};

  if (normalizedMode === 'baseline' || normalizedMode === 'compare') {
    render(baselinePack);
    results.baseline = runTimedIterations({
      iterations,
      run: () => render(baselinePack)
    });
  }

  if (normalizedMode === 'current' || normalizedMode === 'compare') {
    render(currentPack);
    results.current = runTimedIterations({
      iterations,
      run: () => render(currentPack)
    });
  }

  return { schemaVersion: 2, mode: normalizedMode, comparison: 'redundant-sort-removal-on-the-same-canonical-pack',
    preparation: { policy: 'shared-comparators-on-shuffled-input', elapsedMs: preparationMs, includedInRenderTiming: false },
    workload: { nodes: pack.nodes.length, edges: pack.edges.length, paths: pack.paths.length,
      nodeDistanceTies: Math.max(0, size - 2), multipleEdgeKinds: new Set(pack.edges.map(edge => edge.edgeType)).size > 1,
      inputOrder: 'canonical-identical-in-both-arms' },
    parity: { state: 'byte-identical', bytes: Buffer.byteLength(currentOutput, 'utf8'),
      sha256: createHash('sha256').update(currentOutput).digest('hex') }, warmupOperationsPerArm: 1, ...results };
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
