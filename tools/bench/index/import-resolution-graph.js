#!/usr/bin/env node
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';

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

const createRng = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

const args = parseArgs();
const fileCount = Number(args.files) || 2000;
const importsPerFile = Number(args.imports) || 6;
const externalRate = Number(args.externalRate) || 0.25;
const unresolvedRate = Number(args.unresolvedRate) || 0.05;
const seed = Number(args.seed) || 1337;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const rng = createRng(seed);
const benchRoot = path.join(process.cwd(), '.benchCache', 'import-resolution-graph');
const root = path.join(benchRoot, 'repo');

const files = Array.from({ length: fileCount }, (_, index) => `src/module-${index}.ts`);
const entries = files.map((rel) => ({ rel, abs: path.join(root, rel) }));
const importsByFile = new Map();
const fileRelations = new Map();

for (const rel of files) {
  const list = [];
  for (let i = 0; i < importsPerFile; i += 1) {
    const roll = rng();
    if (roll < unresolvedRate) {
      list.push(`./missing-${Math.floor(rng() * fileCount)}.ts`);
    } else if (roll < unresolvedRate + externalRate) {
      const pkg = rng() < 0.2
        ? `@scope/pkg-${Math.floor(rng() * 100)}`
        : `pkg-${Math.floor(rng() * 200)}`;
      list.push(pkg);
    } else {
      const target = pick(rng, files);
      const relDir = path.posix.dirname(rel);
      let spec = path.posix.relative(relDir, target);
      if (!spec.startsWith('.')) spec = `./${spec}`;
      if (rng() < 0.5) {
        spec = spec.replace(/\.ts$/, '');
      }
      list.push(spec);
    }
  }
  importsByFile.set(rel, list);
  fileRelations.set(rel, { imports: list.slice() });
}

const runOnce = ({ label, enableGraph }) => {
  const relations = new Map(fileRelations);
  const start = performance.now();
  const result = resolveImportLinks({
    root,
    entries,
    importsByFile,
    fileRelations: relations,
    enableGraph,
    graphMeta: enableGraph ? { seed } : null,
    log: () => {}
  });
  const durationMs = performance.now() - start;
  const graphStats = result.graph?.stats || null;
  const stats = result.stats || {};
  const nodeCount = graphStats?.nodes ?? stats.nodes ?? null;
  const edgeCount = graphStats?.edges ?? stats.edges ?? 0;
  const throughput = durationMs > 0
    ? Math.round(((nodeCount ?? 0) + edgeCount) / (durationMs / 1000))
    : 0;
  return {
    label,
    durationMs,
    nodeCount,
    edgeCount,
    throughput,
    graphStats
  };
};

const printResult = (result, baseline = null) => {
  const parts = [
    `seed=${seed}`,
    `ms=${result.durationMs.toFixed(1)}`,
    `nodes=${result.nodeCount ?? 'n/a'}`,
    `edges=${result.edgeCount}`,
    `throughput=${result.throughput}/s`
  ];
  if (baseline) {
    const delta = result.durationMs - baseline.durationMs;
    const pct = baseline.durationMs > 0 ? (delta / baseline.durationMs) * 100 : null;
    parts.push(`delta=${delta.toFixed(1)}ms (${pct?.toFixed(1)}%)`);
  }
  console.log(`[bench] ${result.label} ${parts.join(' ')}`);
  if (result.graphStats) {
    const caps = {
      truncatedNodes: result.graphStats.truncatedNodes || 0,
      truncatedEdges: result.graphStats.truncatedEdges || 0,
      maxNodes: result.graphStats.maxNodes || null,
      maxEdges: result.graphStats.maxEdges || null
    };
    console.log(
      `[bench] ${result.label} caps truncatedNodes=${caps.truncatedNodes} ` +
      `truncatedEdges=${caps.truncatedEdges} maxNodes=${caps.maxNodes} maxEdges=${caps.maxEdges}`
    );
  }
};

let baseline = null;
if (mode !== 'current') {
  baseline = runOnce({ label: 'baseline', enableGraph: false });
  printResult(baseline);
}
if (mode !== 'baseline') {
  const current = runOnce({ label: 'current', enableGraph: true });
  printResult(current, baseline);
}
