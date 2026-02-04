#!/usr/bin/env node
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createCli } from '../../src/shared/cli.js';
import { buildCodeMap } from '../../src/map/build-map.js';
import { getIndexDir, resolveRepoConfig } from '../shared/dict-utils.js';

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

const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
const mode = String(argv.mode || 'code').toLowerCase();
const indexDir = getIndexDir(repoRoot, mode, userConfig, {
  indexRoot: argv['index-root'] ? path.resolve(argv['index-root']) : null
});

const resolveLimit = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const buildOptions = {
  mode,
  scope: argv.scope,
  focus: argv.focus || null,
  include: argv.include,
  onlyExported: argv['only-exported'] === true,
  collapse: argv.collapse,
  maxFiles: resolveLimit(argv['max-files']),
  maxMembersPerFile: resolveLimit(argv['max-members-per-file']),
  maxEdges: resolveLimit(argv['max-edges']),
  topKByDegree: argv['top-k-by-degree'] === true
};

const runs = Number.isFinite(Number(argv.runs)) ? Math.max(1, Number(argv.runs)) : 3;
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
