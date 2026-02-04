#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { normalizeOptionalNumber } from '../../../src/shared/limits.js';
import { loadPiecesManifest, MAX_JSON_BYTES } from '../../../src/shared/artifact-io.js';
import { buildIndexSignature } from '../../../src/retrieval/index-cache.js';
import { createGraphStore, buildGraphIndexCacheKey } from '../../../src/graph/store.js';
import { resolveIndexDir } from '../../../src/retrieval/cli-index.js';
import { hasIndexMeta } from '../../../src/retrieval/cli/index-loader.js';
import { loadUserConfig } from '../../shared/dict-utils.js';

const summarize = (values) => {
  if (!values.length) return { min: 0, max: 0, avg: 0 };
  const sorted = values.slice().sort((a, b) => a - b);
  const sum = values.reduce((acc, value) => acc + value, 0);
  const percentile = (p) => {
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p)));
    return sorted[idx];
  };
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / values.length,
    p50: percentile(0.5),
    p95: percentile(0.95)
  };
};

const runIterations = async ({ iterations, loadIndex }) => {
  const timings = [];
  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) {
    const result = await loadIndex();
    void result;
    const elapsed = Number((process.hrtime.bigint() - started) / 1000000n);
    timings.push(elapsed);
  }
  const durationMs = timings[timings.length - 1] || 0;
  const throughput = durationMs > 0 ? iterations / (durationMs / 1000) : 0;
  return {
    iterations,
    timingMs: summarize(timings),
    totalMs: durationMs,
    throughput
  };
};

export async function runGraphStoreBench({ indexDir, repoRoot, iterations, mode }) {
  const manifest = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  const indexSignature = await buildIndexSignature(indexDir);
  const graphStore = createGraphStore({ indexDir, manifest, strict: true, maxBytes: MAX_JSON_BYTES });
  const includeCsr = graphStore.hasArtifact('graph_relations_csr');
  const graphsAll = ['callGraph', 'usageGraph', 'importGraph'];
  const graphCacheKeyAll = buildGraphIndexCacheKey({
    indexSignature,
    repoRoot,
    graphs: graphsAll,
    includeCsr
  });
  const graphCacheKeySubset = buildGraphIndexCacheKey({
    indexSignature,
    repoRoot,
    graphs: ['callGraph'],
    includeCsr
  });
  const normalizedMode = mode === 'baseline' || mode === 'current' ? mode : 'compare';
  const results = {};

  if (normalizedMode === 'baseline' || normalizedMode === 'compare') {
    results.baseline = await runIterations({
      iterations,
      loadIndex: () => graphStore.loadGraphIndex({
        repoRoot,
        cacheKey: graphCacheKeyAll,
        graphs: graphsAll,
        includeCsr
      })
    });
  }

  if (normalizedMode === 'current' || normalizedMode === 'compare') {
    results.current = await runIterations({
      iterations,
      loadIndex: () => graphStore.loadGraphIndex({
        repoRoot,
        cacheKey: graphCacheKeySubset,
        graphs: ['callGraph'],
        includeCsr
      })
    });
  }

  return { mode: normalizedMode, ...results };
}

export async function runGraphStoreBenchCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'graph-store-lazy-load',
    argv: ['node', 'graph-store-lazy-load', ...rawArgs],
    options: {
      index: { type: 'string' },
      repo: { type: 'string' },
      iterations: { type: 'number', default: 3 },
      mode: { type: 'string', default: 'compare' }
    }
  });
  const argv = cli.parse();
  const repoRoot = argv.repo ? path.resolve(argv.repo) : process.cwd();
  const userConfig = loadUserConfig(repoRoot);
  let indexDir = argv.index ? path.resolve(argv.index) : null;
  if (!indexDir) {
    const resolved = resolveIndexDir(repoRoot, 'code', userConfig);
    if (resolved && hasIndexMeta(resolved)) indexDir = resolved;
  }
  if (!indexDir || !fs.existsSync(indexDir)) {
    throw new Error('Missing --index <indexDir> and no built index found for repo.');
  }
  const iterations = normalizeOptionalNumber(argv.iterations) || 3;
  const mode = argv.mode || 'compare';

  const result = await runGraphStoreBench({ indexDir, repoRoot, iterations, mode });

  const formatSummary = (label, summary) => {
    const avg = summary.timingMs.avg.toFixed(2);
    const p95 = summary.timingMs.p95.toFixed(2);
    const total = summary.totalMs.toFixed(1);
    const throughput = summary.throughput.toFixed(2);
    console.log(`[bench] ${label} total=${total}ms avg=${avg}ms p95=${p95}ms throughput=${throughput} it/s`);
  };

  if (result.baseline) formatSummary('baseline', result.baseline);
  if (result.current) formatSummary('current', result.current);
  if (result.baseline && result.current) {
    const deltaMs = result.current.totalMs - result.baseline.totalMs;
    const deltaPct = result.baseline.totalMs ? (deltaMs / result.baseline.totalMs) * 100 : 0;
    const deltaThroughput = result.current.throughput - result.baseline.throughput;
    console.log(
      `[bench] delta ms=${deltaMs.toFixed(1)} throughput=${deltaThroughput.toFixed(2)} it/s ` +
      `pct=${deltaPct.toFixed(1)} duration=${result.current.totalMs.toFixed(1)}ms`
    );
  }

  console.log(JSON.stringify({ ok: true, result }, null, 2));
  return result;
}

if (process.argv[1] && process.argv[1].endsWith('store-lazy-load.js')) {
  runGraphStoreBenchCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
