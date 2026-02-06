#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../../src/shared/cli.js';
import { parseSeedRef } from '../../../src/shared/seed-ref.js';
import { normalizeOptionalNumber } from '../../../src/shared/limits.js';
import {
  MAX_JSON_BYTES,
  loadChunkMeta,
  loadPiecesManifest,
  readCompatibilityKey
} from '../../../src/shared/artifact-io.js';
import { buildIndexSignature } from '../../../src/retrieval/index-cache.js';
import { resolveIndexDir } from '../../../src/retrieval/cli-index.js';
import { hasIndexMeta } from '../../../src/retrieval/cli/index-loader.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { buildGraphIndexCacheKey, createGraphStore } from '../../../src/graph/store.js';
import { buildGraphNeighborhood } from '../../../src/graph/neighborhood.js';
import { buildImpactAnalysis } from '../../../src/graph/impact.js';

const durationMs = (startNs, endNs = process.hrtime.bigint()) => Number(endNs - startNs) / 1_000_000;

const resolveDefaultSeed = (chunkMeta) => {
  const first = Array.isArray(chunkMeta) ? chunkMeta[0] : null;
  if (!first?.chunkUid) return null;
  return { type: 'chunk', chunkUid: first.chunkUid };
};

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

const clearTraversalCaches = (graphIndex) => {
  if (!graphIndex || typeof graphIndex !== 'object') return;
  if (graphIndex._traversalCache) graphIndex._traversalCache.clear();
  if (graphIndex._traversalTelemetry && typeof graphIndex._traversalTelemetry === 'object') {
    graphIndex._traversalTelemetry.hits = 0;
    graphIndex._traversalTelemetry.misses = 0;
    graphIndex._traversalTelemetry.evictions = 0;
  }
  delete graphIndex._csrReverse;
  delete graphIndex._csrReverseByGraph;
};

const runIterations = ({
  iterations,
  buildPayload
}) => {
  const timings = [];
  const rssValues = [];
  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) {
    const payload = buildPayload();
    const elapsed = Number(payload?.stats?.timing?.elapsedMs || 0);
    const rss = Number(payload?.stats?.memory?.peak?.rss || 0);
    timings.push(elapsed);
    rssValues.push(rss);
  }
  const duration = durationMs(started);
  const throughput = duration > 0 ? iterations / (duration / 1000) : 0;
  return {
    iterations,
    timingMs: summarize(timings),
    rssBytes: summarize(rssValues),
    totalMs: duration,
    throughput
  };
};

const runWarmIterations = ({
  iterations,
  primePayload,
  buildPayload
}) => {
  if (typeof primePayload === 'function') {
    primePayload();
  }
  return runIterations({ iterations, buildPayload });
};

export async function runNeighborhoodIndexDirBench({
  indexDir,
  repoRoot,
  seed,
  iterations = 5,
  depth = 2,
  caps = {},
  mode = 'compare'
}) {
  const timings = {};

  const manifestStart = process.hrtime.bigint();
  const manifest = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  timings.manifestMs = durationMs(manifestStart);

  const graphStore = createGraphStore({ indexDir, manifest, strict: true, maxBytes: MAX_JSON_BYTES });

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

  const resolvedSeed = seed || resolveDefaultSeed(chunkMeta);
  if (!resolvedSeed) {
    throw new Error('Unable to resolve seed for neighborhood index-dir bench.');
  }

  const graphs = ['callGraph', 'usageGraph', 'importGraph'];
  const cacheKeyLegacy = buildGraphIndexCacheKey({
    indexSignature,
    repoRoot,
    graphs,
    includeCsr: false
  });
  const cacheKeyCsr = buildGraphIndexCacheKey({
    indexSignature,
    repoRoot,
    graphs,
    includeCsr: true
  });

  const graphLegacyStart = process.hrtime.bigint();
  const graphIndexLegacy = await graphStore.loadGraphIndex({
    repoRoot,
    cacheKey: cacheKeyLegacy,
    graphs,
    includeCsr: false,
    indexSignature
  });
  timings.graphIndexLegacyColdMs = durationMs(graphLegacyStart);

  const graphCsrStart = process.hrtime.bigint();
  const graphIndexCsr = await graphStore.loadGraphIndex({
    repoRoot,
    cacheKey: cacheKeyCsr,
    graphs,
    includeCsr: true,
    indexSignature
  });
  timings.graphIndexCsrColdMs = durationMs(graphCsrStart);

  const normalizedMode = mode === 'baseline' || mode === 'current' ? mode : 'compare';
  const preferredGraphIndex = graphIndexCsr?.graphRelationsCsr ? graphIndexCsr : graphIndexLegacy;

  const neighborhoodArgs = (includePaths, graphIndex) => (graphIndex
    ? ({
      seed: resolvedSeed,
      graphIndex,
      direction: 'both',
      depth,
      includePaths,
      caps,
      indexSignature,
      indexCompatKey: indexCompatKey || null,
      repo: null,
      indexDir
    })
    : ({
      seed: resolvedSeed,
      graphRelations,
      graphIndex: null,
      direction: 'both',
      depth,
      includePaths,
      caps,
      indexSignature,
      indexCompatKey: indexCompatKey || null,
      repo: null,
      indexDir
    }));

  const impactArgs = (graphIndex) => (graphIndex
    ? ({
      seed: resolvedSeed,
      graphIndex,
      direction: 'downstream',
      depth,
      caps,
      indexSignature,
      indexCompatKey: indexCompatKey || null,
      repo: null,
      indexDir
    })
    : ({
      seed: resolvedSeed,
      graphRelations,
      graphIndex: null,
      direction: 'downstream',
      depth,
      caps,
      indexSignature,
      indexCompatKey: indexCompatKey || null,
      repo: null,
      indexDir
    }));

  const results = {
    neighborhood: {
      includePathsFalse: {},
      includePathsTrue: {}
    },
    impact: {}
  };

  if (normalizedMode === 'baseline' || normalizedMode === 'compare') {
    results.neighborhood.includePathsFalse.baseline = runIterations({
      iterations,
      buildPayload: () => buildGraphNeighborhood(neighborhoodArgs(false, null))
    });
    results.neighborhood.includePathsTrue.baseline = runIterations({
      iterations,
      buildPayload: () => buildGraphNeighborhood(neighborhoodArgs(true, null))
    });
    results.impact.baseline = runIterations({
      iterations,
      buildPayload: () => buildImpactAnalysis(impactArgs(null))
    });
  }

  if (normalizedMode === 'current' || normalizedMode === 'compare') {
    // Cold: clear traversal caches before each iteration.
    results.neighborhood.includePathsFalse.currentCold = runIterations({
      iterations,
      buildPayload: () => {
        clearTraversalCaches(preferredGraphIndex);
        return buildGraphNeighborhood(neighborhoodArgs(false, preferredGraphIndex));
      }
    });
    results.neighborhood.includePathsTrue.currentCold = runIterations({
      iterations,
      buildPayload: () => {
        clearTraversalCaches(preferredGraphIndex);
        return buildGraphNeighborhood(neighborhoodArgs(true, preferredGraphIndex));
      }
    });
    results.impact.currentCold = runIterations({
      iterations,
      buildPayload: () => {
        clearTraversalCaches(preferredGraphIndex);
        return buildImpactAnalysis(impactArgs(preferredGraphIndex));
      }
    });

    // Warm: prime once, then measure cache-hit iterations.
    results.neighborhood.includePathsFalse.currentWarm = runWarmIterations({
      iterations,
      primePayload: () => {
        clearTraversalCaches(preferredGraphIndex);
        buildGraphNeighborhood(neighborhoodArgs(false, preferredGraphIndex));
      },
      buildPayload: () => buildGraphNeighborhood(neighborhoodArgs(false, preferredGraphIndex))
    });
    results.neighborhood.includePathsTrue.currentWarm = runWarmIterations({
      iterations,
      primePayload: () => {
        clearTraversalCaches(preferredGraphIndex);
        buildGraphNeighborhood(neighborhoodArgs(true, preferredGraphIndex));
      },
      buildPayload: () => buildGraphNeighborhood(neighborhoodArgs(true, preferredGraphIndex))
    });
    results.impact.currentWarm = runWarmIterations({
      iterations,
      primePayload: () => {
        clearTraversalCaches(preferredGraphIndex);
        buildImpactAnalysis(impactArgs(preferredGraphIndex));
      },
      buildPayload: () => buildImpactAnalysis(impactArgs(preferredGraphIndex))
    });
  }

  const graphStoreStats = graphStore.stats();
  const traversalTelemetry = preferredGraphIndex?._traversalTelemetry && typeof preferredGraphIndex._traversalTelemetry === 'object'
    ? preferredGraphIndex._traversalTelemetry
    : null;

  return {
    mode: normalizedMode,
    meta: {
      seed: resolvedSeed,
      timings,
      graphStore: graphStoreStats,
      graphStoreArtifactsUsed: graphStore.getArtifactsUsed(),
      csr: {
        available: graphStore.hasArtifact('graph_relations_csr'),
        legacyEnabled: Boolean(graphIndexLegacy?.graphRelationsCsr),
        csrEnabled: Boolean(graphIndexCsr?.graphRelationsCsr),
        preferred: preferredGraphIndex === graphIndexCsr ? 'csr' : 'legacy'
      },
      traversalCache: {
        size: preferredGraphIndex?._traversalCache?.size || 0,
        telemetry: traversalTelemetry
      }
    },
    ...results
  };
}

export async function runNeighborhoodIndexDirBenchCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'graph-neighborhood-index-dir',
    argv: ['node', 'graph-neighborhood-index-dir', ...rawArgs],
    options: {
      index: { type: 'string' },
      repo: { type: 'string' },
      seed: { type: 'string' },
      iterations: { type: 'number', default: 5 },
      depth: { type: 'number', default: 2 },
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

  const seed = argv.seed ? parseSeedRef(argv.seed, repoRoot) : null;
  const iterations = normalizeOptionalNumber(argv.iterations) || 5;
  const depth = normalizeOptionalNumber(argv.depth) || 2;
  const mode = argv.mode || 'compare';

  const result = await runNeighborhoodIndexDirBench({
    indexDir,
    repoRoot,
    seed,
    iterations,
    depth,
    mode
  });

  const reportCase = (label, summary) => {
    if (!summary) return;
    const avg = summary.timingMs.avg.toFixed(2);
    const p95 = summary.timingMs.p95.toFixed(2);
    const total = summary.totalMs.toFixed(1);
    const throughput = summary.throughput.toFixed(2);
    console.log(`[bench] ${label} total=${total}ms avg=${avg}ms p95=${p95}ms throughput=${throughput} it/s`);
  };

  const flattenCases = (obj, prefix) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      const label = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && 'timingMs' in value) {
        reportCase(label, value);
        continue;
      }
      flattenCases(value, label);
    }
  };

  flattenCases(result.neighborhood, 'neighborhood');
  flattenCases(result.impact, 'impact');
  console.log(JSON.stringify({ ok: true, result }, null, 2));
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runNeighborhoodIndexDirBenchCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
