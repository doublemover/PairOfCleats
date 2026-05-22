#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

import { buildCodeMap } from '../../../src/map/build-map.js';
import { createMapBenchCli, resolveMapBenchInputs, resolveRuns } from './shared.js';

const argv = createMapBenchCli({
  scriptName: 'bench-map-memory',
  options: {
    runs: { type: 'number', default: 3 },
    json: { type: 'boolean', default: false }
  }
});

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
