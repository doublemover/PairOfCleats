#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../src/shared/cli.js';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { loadGraphRelations } from '../../src/shared/artifact-io.js';

const resolveGraphStats = (graphRelations) => {
  const stats = {};
  const add = (key, graph) => {
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const edgeCount = nodes.reduce((sum, node) => sum + (Array.isArray(node.out) ? node.out.length : 0), 0);
    stats[key] = {
      nodes: nodes.length,
      edges: edgeCount
    };
  };
  add('callGraph', graphRelations?.callGraph);
  add('usageGraph', graphRelations?.usageGraph);
  add('importGraph', graphRelations?.importGraph);
  return stats;
};

const resolveDefaultSeed = (graphRelations) => {
  const nodes = Array.isArray(graphRelations?.callGraph?.nodes) ? graphRelations.callGraph.nodes : [];
  const first = nodes[0];
  if (first?.id) return { type: 'chunk', chunkUid: first.id };
  return null;
};

export async function runGraphCapsHarness({
  graphRelations,
  outDir,
  seeds = null,
  depth = 2,
  caps = {}
}) {
  if (!graphRelations) throw new Error('graphRelations required.');
  if (!outDir) throw new Error('outDir required.');

  const resolvedSeeds = Array.isArray(seeds) && seeds.length
    ? seeds
    : [resolveDefaultSeed(graphRelations)].filter(Boolean);

  const samples = resolvedSeeds.map((seed) => {
    const neighborhood = buildGraphNeighborhood({
      seed,
      graphRelations,
      direction: 'both',
      depth,
      caps,
      includePaths: false
    });
    return {
      seed,
      counts: neighborhood?.stats?.counts || null,
      truncation: neighborhood?.truncation || null
    };
  });

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    graphStats: resolveGraphStats(graphRelations),
    samples
  };

  fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, 'graph-caps-harness.json');
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  return { outputPath, payload };
}

export async function runGraphCapsHarnessCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'graph-caps-harness',
    argv: ['node', 'graph-caps-harness', ...rawArgs],
    options: {
      index: { type: 'string' },
      graphFixture: { type: 'string' },
      outDir: { type: 'string' },
      depth: { type: 'number', default: 2 }
    }
  });
  const argv = cli.parse();

  const outDir = argv.outDir ? path.resolve(argv.outDir) : null;
  if (!outDir) {
    throw new Error('Missing --outDir <path>.');
  }

  let graphRelations = null;
  if (argv.graphFixture) {
    const fixturePath = path.resolve(String(argv.graphFixture));
    graphRelations = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  } else if (argv.index) {
    const indexDir = path.resolve(String(argv.index));
    graphRelations = await loadGraphRelations(indexDir, { strict: true });
  } else {
    throw new Error('Provide --graphFixture or --index.');
  }

  const result = await runGraphCapsHarness({
    graphRelations,
    outDir,
    depth: Number(argv.depth) || 2,
    caps: { maxFanoutPerNode: 100, maxNodes: 200, maxEdges: 500 }
  });
  console.log(JSON.stringify({ ok: true, outputPath: result.outputPath }, null, 2));
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runGraphCapsHarnessCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
