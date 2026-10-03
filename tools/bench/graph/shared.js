import fs from 'node:fs';
import path from 'node:path';

import { createCli } from '../../../src/shared/cli.js';
import { parseSeedRef } from '../../../src/shared/seed-ref.js';
import { normalizeOptionalNumber } from '../../../src/shared/limits.js';
import { MAX_JSON_BYTES } from '../../../src/shared/artifact-io/constants.js';
import { loadChunkMeta } from '../../../src/shared/artifact-io/loaders.js';
import { loadPiecesManifest, readCompatibilityKey } from '../../../src/shared/artifact-io/manifest.js';
import { buildIndexSignature } from '../../../src/retrieval/index-cache.js';
import { hasIndexMeta } from '../../../src/retrieval/cli/index-loader.js';
import { resolveIndexDir } from '../../../src/retrieval/cli-index.js';
import { createGraphStore } from '../../../src/graph/store.js';
import { loadUserConfig } from '../../shared/dict-utils.js';

export const GRAPH_BENCH_GRAPHS = ['callGraph', 'usageGraph', 'importGraph'];

export const durationMs = (startNs, endNs = process.hrtime.bigint()) => Number(endNs - startNs) / 1_000_000;

export const normalizeCompareMode = (mode) => (mode === 'baseline' || mode === 'current' ? mode : 'compare');

export const summarizeValues = (values) => {
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

export const runPayloadIterations = ({
  iterations,
  buildPayload,
  includeRss = true
}) => {
  const timings = [];
  const rssValues = [];
  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) {
    const payload = buildPayload();
    timings.push(Number(payload?.stats?.timing?.elapsedMs || 0));
    if (includeRss) rssValues.push(Number(payload?.stats?.memory?.peak?.rss || 0));
  }
  const totalMs = durationMs(started);
  const throughput = totalMs > 0 ? iterations / (totalMs / 1000) : 0;
  return {
    iterations,
    timingMs: summarizeValues(timings),
    ...(includeRss ? { rssBytes: summarizeValues(rssValues) } : {}),
    totalMs,
    throughput
  };
};

export const runWarmPayloadIterations = ({
  iterations,
  primePayload,
  buildPayload
}) => {
  if (typeof primePayload === 'function') primePayload();
  return runPayloadIterations({ iterations, buildPayload });
};

export const runTimedIterations = ({ iterations, run, totalMode = 'sum' }) => {
  const timings = [];
  const started = process.hrtime.bigint();
  let totalMs = 0;
  for (let i = 0; i < iterations; i += 1) {
    const iterationStart = process.hrtime.bigint();
    const result = run();
    void result;
    const elapsed = durationMs(iterationStart);
    timings.push(elapsed);
    totalMs += elapsed;
  }
  if (totalMode === 'wall') totalMs = durationMs(started);
  const throughput = totalMs > 0 ? iterations / (totalMs / 1000) : 0;
  return {
    iterations,
    timingMs: summarizeValues(timings),
    totalMs,
    throughput
  };
};

export const runAsyncTimedIterations = async ({ iterations, run }) => {
  const timings = [];
  let totalMs = 0;
  for (let i = 0; i < iterations; i += 1) {
    const started = process.hrtime.bigint();
    const result = await run();
    void result;
    const elapsed = durationMs(started);
    timings.push(elapsed);
    totalMs += elapsed;
  }
  const throughput = totalMs > 0 ? iterations / (totalMs / 1000) : 0;
  return {
    iterations,
    timingMs: summarizeValues(timings),
    totalMs,
    throughput
  };
};

export const resolveDefaultChunkSeed = (chunkMeta) => {
  const first = Array.isArray(chunkMeta) ? chunkMeta[0] : null;
  if (!first?.chunkUid) return null;
  return { type: 'chunk', chunkUid: first.chunkUid };
};

export const loadGraphBenchInputs = async ({
  indexDir,
  seed,
  missingSeedMessage
}) => {
  const timings = {};

  const manifestStart = process.hrtime.bigint();
  const manifest = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  timings.manifestMs = durationMs(manifestStart);

  const graphStore = createGraphStore({ indexDir, manifest, strict: true, maxBytes: MAX_JSON_BYTES });
  const includeCsr = graphStore.hasArtifact('graph_relations_csr');

  const chunkMetaStart = process.hrtime.bigint();
  const chunkMeta = await loadChunkMeta(indexDir, { maxBytes: MAX_JSON_BYTES, manifest, strict: true });
  timings.chunkMetaMs = durationMs(chunkMetaStart);

  const graphRelationsStart = process.hrtime.bigint();
  const graphRelations = await graphStore.loadGraph();
  timings.graphRelationsMs = durationMs(graphRelationsStart);

  const compatStart = process.hrtime.bigint();
  const { key: indexCompatKey } = readCompatibilityKey(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  timings.compatKeyMs = durationMs(compatStart);

  const signatureStart = process.hrtime.bigint();
  const indexSignature = await buildIndexSignature(indexDir);
  timings.indexSignatureMs = durationMs(signatureStart);

  const resolvedSeed = seed || resolveDefaultChunkSeed(chunkMeta);
  if (!resolvedSeed) {
    throw new Error(missingSeedMessage);
  }

  return {
    timings,
    manifest,
    graphStore,
    includeCsr,
    chunkMeta,
    graphRelations,
    indexCompatKey,
    indexSignature,
    resolvedSeed
  };
};

export const clearGraphTraversalCaches = (graphIndex, {
  resetTelemetry = false,
  clearCsrReverse = false
} = {}) => {
  if (!graphIndex || typeof graphIndex !== 'object') return;
  if (graphIndex._traversalCache) graphIndex._traversalCache.clear();
  if (resetTelemetry && graphIndex._traversalTelemetry && typeof graphIndex._traversalTelemetry === 'object') {
    graphIndex._traversalTelemetry.hits = 0;
    graphIndex._traversalTelemetry.misses = 0;
    graphIndex._traversalTelemetry.evictions = 0;
  }
  if (clearCsrReverse) {
    delete graphIndex._csrReverse;
    delete graphIndex._csrReverseByGraph;
  }
};

export const formatBenchSummary = (label, summary) => {
  const avg = summary.timingMs.avg.toFixed(2);
  const p95 = summary.timingMs.p95.toFixed(2);
  const total = summary.totalMs.toFixed(1);
  const throughput = summary.throughput.toFixed(2);
  console.log(`[bench] ${label} total=${total}ms avg=${avg}ms p95=${p95}ms throughput=${throughput} it/s`);
};

export const printBenchComparison = (baseline, current) => {
  const deltaMs = current.totalMs - baseline.totalMs;
  const deltaPct = baseline.totalMs ? (deltaMs / baseline.totalMs) * 100 : 0;
  const deltaThroughput = current.throughput - baseline.throughput;
  console.log(
    `[bench] delta ms=${deltaMs.toFixed(1)} throughput=${deltaThroughput.toFixed(2)} it/s ` +
    `pct=${deltaPct.toFixed(1)} duration=${current.totalMs.toFixed(1)}ms`
  );
};

export const printBaselineCurrentSummary = (result) => {
  if (result.baseline) formatBenchSummary('baseline', result.baseline);
  if (result.current) formatBenchSummary('current', result.current);
  if (result.baseline && result.current) printBenchComparison(result.baseline, result.current);
};

export const printNestedBenchSummaries = (obj, prefix) => {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    const label = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && 'timingMs' in value) {
      formatBenchSummary(label, value);
      continue;
    }
    printNestedBenchSummaries(value, label);
  }
};

export const parseGraphIndexBenchCli = (rawArgs, {
  scriptName,
  options = {}
}) => {
  const cli = createCli({
    scriptName,
    argv: ['node', scriptName, ...rawArgs],
    options: {
      index: { type: 'string' },
      repo: { type: 'string' },
      ...options
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
  return { argv, repoRoot, indexDir };
};

export const readNumberArg = (value, fallback) => normalizeOptionalNumber(value) || fallback;

export const parseGraphBenchStandardCli = (rawArgs, {
  scriptName
}) => {
  const { argv, repoRoot, indexDir } = parseGraphIndexBenchCli(rawArgs, {
    scriptName,
    options: {
      seed: { type: 'string' },
      iterations: { type: 'number', default: 5 },
      depth: { type: 'number', default: 2 },
      mode: { type: 'string', default: 'compare' }
    }
  });

  return {
    argv,
    repoRoot,
    indexDir,
    seed: argv.seed ? parseSeedRef(argv.seed, repoRoot) : null,
    iterations: readNumberArg(argv.iterations, 5),
    depth: readNumberArg(argv.depth, 2),
    mode: argv.mode || 'compare'
  };
};
