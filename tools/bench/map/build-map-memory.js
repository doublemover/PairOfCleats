#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

import { createCli } from '../../../src/shared/cli.js';
import { buildCodeMap } from '../../../src/map/build-map.js';
import { resolveMapBenchInputs, resolveRuns } from './shared.js';

const argv = createCli({
  scriptName: 'bench-map-memory',
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
    json: { type: 'boolean', default: false }
  }
}).parse();

const { repoRoot, indexDir, buildOptions } = resolveMapBenchInputs(argv);
const runs = resolveRuns(argv.runs, 3);
const results = [];

for (let i = 0; i < runs; i += 1) {
  const start = performance.now();
  const mapModel = await buildCodeMap({ repoRoot, indexDir, options: buildOptions });
  const elapsedMs = Math.round((performance.now() - start) * 100) / 100;
  results.push({
    run: i + 1,
    elapsedMs,
    peak: mapModel.buildMetrics?.peak || null,
    counts: mapModel.summary?.counts || null
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  repoRoot,
  indexDir,
  runs,
  results
};

if (argv.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.error('Map build memory benchmark');
  console.error(`- Repo: ${repoRoot}`);
  console.error(`- Index: ${indexDir}`);
  results.forEach((entry) => {
    const peakHeap = entry.peak?.heapUsed
      ? Math.round(entry.peak.heapUsed / (1024 * 1024))
      : null;
    const peakRss = entry.peak?.rss ? Math.round(entry.peak.rss / (1024 * 1024)) : null;
    console.error(`- Run ${entry.run}: ${entry.elapsedMs} ms (heap ${peakHeap ?? 'n/a'} MB, rss ${peakRss ?? 'n/a'} MB)`);
  });
}
