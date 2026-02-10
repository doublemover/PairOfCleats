#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { createCli } from '../../../src/shared/cli.js';
import { buildCodeMap } from '../../../src/map/build-map.js';
import { writeMapJsonStream } from '../../../src/map/build-map/io.js';
import { resolveMapBenchInputs, resolveRuns } from './shared.js';

const argv = createCli({
  scriptName: 'bench-map-streaming',
  options: {
    repo: { type: 'string', describe: 'Repo root.' },
    mode: { type: 'string', default: 'code' },
    'index-root': { type: 'string' },
    scope: { type: 'string', default: 'repo' },
    focus: { type: 'string' },
    include: { type: 'string' },
    'only-exported': { type: 'boolean', default: false },
    collapse: { type: 'string', default: 'none' },
    'max-files': { type: 'number' },
    'max-members-per-file': { type: 'number' },
    'max-edges': { type: 'number' },
    'top-k-by-degree': { type: 'boolean', default: false },
    runs: { type: 'number', default: 3 },
    out: { type: 'string' },
    json: { type: 'boolean', default: false }
  }
}).parse();

const root = process.cwd();
const { repoRoot, indexDir, buildOptions } = resolveMapBenchInputs(argv);
const runs = resolveRuns(argv.runs, 3);

const outDir = argv.out
  ? path.resolve(argv.out)
  : path.join(root, '.bench', 'map');
await fs.mkdir(outDir, { recursive: true });

const mapStart = performance.now();
const mapModel = await buildCodeMap({ repoRoot, indexDir, options: buildOptions });
const mapElapsedMs = Math.round((performance.now() - mapStart) * 100) / 100;

const mapBase = { ...mapModel };
delete mapBase.nodes;
delete mapBase.edges;

const buildStats = (values) => {
  if (!values.length) return { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, minMs: 0, maxMs: 0 };
  const sorted = values.slice().sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    count: values.length,
    avgMs: Math.round((sum / values.length) * 100) / 100,
    p50Ms: Math.round(pick(0.5) * 100) / 100,
    p95Ms: Math.round(pick(0.95) * 100) / 100,
    minMs: Math.round(sorted[0] * 100) / 100,
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100
  };
};

const measure = async (label, writer) => {
  const timings = [];
  let peakHeap = 0;
  let peakRss = 0;
  for (let i = 0; i < runs; i += 1) {
    const outPath = path.join(outDir, `${label}-${i + 1}.json`);
    const startMem = process.memoryUsage();
    const start = performance.now();
    await writer(outPath);
    const elapsed = performance.now() - start;
    timings.push(elapsed);
    const endMem = process.memoryUsage();
    peakHeap = Math.max(peakHeap, startMem.heapUsed, endMem.heapUsed);
    peakRss = Math.max(peakRss, startMem.rss, endMem.rss);
    await fs.rm(outPath, { force: true });
  }
  return {
    label,
    timings: buildStats(timings),
    peakHeap,
    peakRss
  };
};

const baseline = await measure('baseline', async (outPath) => {
  const json = JSON.stringify(mapModel);
  await fs.writeFile(outPath, json);
});

const streaming = await measure('streaming', async (outPath) => {
  await writeMapJsonStream({
    filePath: outPath,
    mapBase,
    nodes: mapModel.nodes || [],
    edges: mapModel.edges || []
  });
});

const summary = {
  generatedAt: new Date().toISOString(),
  repoRoot,
  indexDir,
  runs,
  buildElapsedMs: mapElapsedMs,
  counts: mapModel.summary?.counts || null,
  baseline,
  streaming
};

if (argv.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.error('Map streaming benchmark');
  console.error(`- Repo: ${repoRoot}`);
  console.error(`- Index: ${indexDir}`);
  console.error(`- Build: ${mapElapsedMs} ms`);
  const render = (label, stats) => {
    console.error(`- ${label} avg: ${stats.timings.avgMs} ms (p95 ${stats.timings.p95Ms} ms)`);
    console.error(`  peak heap: ${Math.round(stats.peakHeap / (1024 * 1024))} MB`);
  };
  render('baseline', baseline);
  render('streaming', streaming);
}
