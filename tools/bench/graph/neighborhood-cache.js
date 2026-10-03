#!/usr/bin/env node
import { createCli } from '../../../src/shared/cli.js';
import { isDirectExecution } from '../../../src/shared/direct-execution.js';
import { buildGraphNeighborhood } from '../../../src/graph/neighborhood.js';
import { buildGraphIndex } from '../../../src/graph/store.js';
import {
  normalizeCompareMode,
  printBaselineCurrentSummary,
  readNumberArg,
  runPayloadIterations
} from './shared.js';

const buildSyntheticGraph = ({ nodes, fanout }) => {
  const graphNodes = [];
  for (let i = 0; i < nodes; i += 1) {
    const id = `chunk-${i}`;
    const out = [];
    for (let j = 1; j <= fanout; j += 1) {
      const target = (i + j) % nodes;
      out.push(`chunk-${target}`);
    }
    const incoming = [];
    for (let j = 1; j <= fanout; j += 1) {
      const source = (i - j + nodes) % nodes;
      incoming.push(`chunk-${source}`);
    }
    graphNodes.push({
      id,
      out,
      in: incoming
    });
  }
  return {
    version: 1,
    callGraph: {
      nodeCount: nodes,
      edgeCount: nodes * fanout,
      nodes: graphNodes
    },
    usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
  };
};

export async function runNeighborhoodBench({
  nodes,
  fanout,
  depth,
  iterations,
  mode
}) {
  const graphRelations = buildSyntheticGraph({ nodes, fanout });
  const graphIndex = buildGraphIndex({ graphRelations });
  const seed = { type: 'chunk', chunkUid: 'chunk-0' };
  const normalizedMode = normalizeCompareMode(mode);
  const results = {};

  if (normalizedMode === 'baseline' || normalizedMode === 'compare') {
    results.baseline = runPayloadIterations({
      iterations,
      includeRss: false,
      buildPayload: () => buildGraphNeighborhood({
        seed,
        graphRelations,
        graphIndex: null,
        depth
      })
    });
  }

  if (normalizedMode === 'current' || normalizedMode === 'compare') {
    results.current = runPayloadIterations({
      iterations,
      includeRss: false,
      buildPayload: () => buildGraphNeighborhood({
        seed,
        graphRelations,
        graphIndex,
        depth
      })
    });
  }

  return { mode: normalizedMode, ...results };
}

export async function runNeighborhoodBenchCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'graph-neighborhood-bench',
    argv: ['node', 'graph-neighborhood-bench', ...rawArgs],
    options: {
      nodes: { type: 'number', default: 2000 },
      fanout: { type: 'number', default: 6 },
      depth: { type: 'number', default: 2 },
      iterations: { type: 'number', default: 5 },
      mode: { type: 'string', default: 'compare' }
    }
  });
  const argv = cli.parse();
  const nodes = readNumberArg(argv.nodes, 2000);
  const fanout = readNumberArg(argv.fanout, 6);
  const depth = readNumberArg(argv.depth, 2);
  const iterations = readNumberArg(argv.iterations, 5);
  const mode = argv.mode || 'compare';

  const result = await runNeighborhoodBench({
    nodes,
    fanout,
    depth,
    iterations,
    mode
  });

  printBaselineCurrentSummary(result);

  console.log(JSON.stringify({ ok: true, result }, null, 2));
  return result;
}

if (isDirectExecution(import.meta.url)) {
  runNeighborhoodBenchCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
