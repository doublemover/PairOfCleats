#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonLinesSharded, writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { createGraphRelationsIterator, measureGraphRelations } from '../../../src/index/build/artifacts/helpers.js';

const parseArgs = () => {
  const out = {};
  const argv = process.argv.slice(2);
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

const args = parseArgs();
const nodesPerGraph = Number(args.nodes) || 20000;
const edgesPerNode = Number(args.edges) || 3;
const maxBytes = Number(args.maxBytes) || 2 * 1024 * 1024;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const benchRoot = path.join(process.cwd(), '.benchCache', 'graph-relations');
await fs.rm(benchRoot, { recursive: true, force: true });
await fs.mkdir(benchRoot, { recursive: true });

const buildGraphNodes = (prefix) => {
  const nodes = new Array(nodesPerGraph);
  for (let i = 0; i < nodesPerGraph; i += 1) {
    const id = `${prefix}-${i}`;
    const out = [];
    for (let j = 1; j <= edgesPerNode; j += 1) {
      out.push(`${prefix}-${(i + j) % nodesPerGraph}`);
    }
    nodes[i] = {
      id,
      out,
      in: []
    };
  }
  return nodes;
};

const graphRelations = {
  version: 2,
  generatedAt: new Date().toISOString(),
  callGraph: {
    nodeCount: nodesPerGraph,
    edgeCount: nodesPerGraph * edgesPerNode,
    nodes: buildGraphNodes('call')
  },
  usageGraph: {
    nodeCount: nodesPerGraph,
    edgeCount: nodesPerGraph * edgesPerNode,
    nodes: buildGraphNodes('usage')
  },
  importGraph: {
    nodeCount: nodesPerGraph,
    edgeCount: nodesPerGraph * edgesPerNode,
    nodes: buildGraphNodes('import')
  }
};

const runBaseline = async () => {
  const graphPath = path.join(benchRoot, 'graph_relations.json');
  const start = performance.now();
  await writeJsonObjectFile(graphPath, { fields: graphRelations, atomic: true });
  const durationMs = performance.now() - start;
  const stat = await fs.stat(graphPath);
  return { durationMs, bytes: stat.size };
};

const runCurrent = async () => {
  const graphMetaPath = path.join(benchRoot, 'graph_relations.meta.json');
  const graphMeasurement = measureGraphRelations(graphRelations, { maxJsonBytes: maxBytes });
  const start = performance.now();
  const result = await writeJsonLinesSharded({
    dir: benchRoot,
    partsDirName: 'graph_relations.parts',
    partPrefix: 'graph_relations.part-',
    items: createGraphRelationsIterator(graphRelations)(),
    maxBytes,
    atomic: true
  });
  await writeJsonObjectFile(graphMetaPath, {
    fields: {
      schemaVersion: 1,
      artifact: 'graph_relations',
      format: 'jsonl-sharded',
      generatedAt: graphMeasurement?.generatedAt || new Date().toISOString(),
      compression: 'none',
      totalRecords: result.total,
      totalBytes: result.totalBytes,
      maxPartRecords: result.maxPartRecords,
      maxPartBytes: result.maxPartBytes,
      targetMaxBytes: result.targetMaxBytes,
      parts: result.parts.map((part, index) => ({
        path: part,
        records: result.counts[index] || 0,
        bytes: result.bytes[index] || 0
      }))
    },
    atomic: true
  });
  const durationMs = performance.now() - start;
  const bytesPerSec = durationMs > 0 ? (result.totalBytes / (durationMs / 1000)) : 0;
  return { durationMs, bytes: result.totalBytes, parts: result.parts.length, bytesPerSec };
};

const printBaseline = (result) => {
  console.log(`[bench] baseline ms=${result.durationMs.toFixed(1)} bytes=${result.bytes}`);
};

const printCurrent = (result, baseline = null) => {
  const parts = [
    `ms=${result.durationMs.toFixed(1)}`,
    `bytes=${result.bytes}`,
    `parts=${result.parts}`,
    `bytes/sec=${Math.round(result.bytesPerSec)}`
  ];
  if (baseline) {
    const delta = result.durationMs - baseline.durationMs;
    const pct = baseline.durationMs > 0 ? (delta / baseline.durationMs) * 100 : null;
    parts.push(`delta=${delta.toFixed(1)}ms (${pct?.toFixed(1)}%)`);
  }
  console.log(`[bench] current ${parts.join(' ')}`);
};

let baseline = null;
if (mode !== 'current') {
  baseline = await runBaseline();
  printBaseline(baseline);
}
if (mode !== 'baseline') {
  const current = await runCurrent();
  printCurrent(current, baseline);
}
