#!/usr/bin/env node
import { isDirectExecution } from '../../../src/shared/direct-execution.js';
import { buildGraphIndexCacheKey } from '../../../src/graph/store.js';
import { buildGraphNeighborhood } from '../../../src/graph/neighborhood.js';
import { buildImpactAnalysis } from '../../../src/graph/impact.js';
import {
  clearGraphTraversalCaches,
  durationMs,
  GRAPH_BENCH_GRAPHS,
  loadGraphBenchInputs,
  normalizeCompareMode,
  parseGraphBenchStandardCli,
  printNestedBenchSummaries,
  runPayloadIterations,
  runWarmPayloadIterations
} from './shared.js';

export async function runNeighborhoodIndexDirBench({
  indexDir,
  repoRoot,
  seed,
  iterations = 5,
  depth = 2,
  caps = {},
  mode = 'compare'
}) {
  const {
    timings,
    graphStore,
    graphRelations,
    indexCompatKey,
    indexSignature,
    resolvedSeed
  } = await loadGraphBenchInputs({
    indexDir,
    seed,
    missingSeedMessage: 'Unable to resolve seed for neighborhood index-dir bench.'
  });

  const cacheKeyLegacy = buildGraphIndexCacheKey({
    indexSignature,
    repoRoot,
    graphs: GRAPH_BENCH_GRAPHS,
    includeCsr: false
  });
  const cacheKeyCsr = buildGraphIndexCacheKey({
    indexSignature,
    repoRoot,
    graphs: GRAPH_BENCH_GRAPHS,
    includeCsr: true
  });

  const graphLegacyStart = process.hrtime.bigint();
  const graphIndexLegacy = await graphStore.loadGraphIndex({
    repoRoot,
    cacheKey: cacheKeyLegacy,
    graphs: GRAPH_BENCH_GRAPHS,
    includeCsr: false,
    indexSignature
  });
  timings.graphIndexLegacyColdMs = durationMs(graphLegacyStart);

  const graphCsrStart = process.hrtime.bigint();
  const graphIndexCsr = await graphStore.loadGraphIndex({
    repoRoot,
    cacheKey: cacheKeyCsr,
    graphs: GRAPH_BENCH_GRAPHS,
    includeCsr: true,
    indexSignature
  });
  timings.graphIndexCsrColdMs = durationMs(graphCsrStart);

  const normalizedMode = normalizeCompareMode(mode);
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
    results.neighborhood.includePathsFalse.baseline = runPayloadIterations({
      iterations,
      buildPayload: () => buildGraphNeighborhood(neighborhoodArgs(false, null))
    });
    results.neighborhood.includePathsTrue.baseline = runPayloadIterations({
      iterations,
      buildPayload: () => buildGraphNeighborhood(neighborhoodArgs(true, null))
    });
    results.impact.baseline = runPayloadIterations({
      iterations,
      buildPayload: () => buildImpactAnalysis(impactArgs(null))
    });
  }

  if (normalizedMode === 'current' || normalizedMode === 'compare') {
    // Cold: clear traversal caches before each iteration.
    results.neighborhood.includePathsFalse.currentCold = runPayloadIterations({
      iterations,
      buildPayload: () => {
        clearGraphTraversalCaches(preferredGraphIndex, { resetTelemetry: true, clearCsrReverse: true });
        return buildGraphNeighborhood(neighborhoodArgs(false, preferredGraphIndex));
      }
    });
    results.neighborhood.includePathsTrue.currentCold = runPayloadIterations({
      iterations,
      buildPayload: () => {
        clearGraphTraversalCaches(preferredGraphIndex, { resetTelemetry: true, clearCsrReverse: true });
        return buildGraphNeighborhood(neighborhoodArgs(true, preferredGraphIndex));
      }
    });
    results.impact.currentCold = runPayloadIterations({
      iterations,
      buildPayload: () => {
        clearGraphTraversalCaches(preferredGraphIndex, { resetTelemetry: true, clearCsrReverse: true });
        return buildImpactAnalysis(impactArgs(preferredGraphIndex));
      }
    });

    // Warm: prime once, then measure cache-hit iterations.
    results.neighborhood.includePathsFalse.currentWarm = runWarmPayloadIterations({
      iterations,
      primePayload: () => {
        clearGraphTraversalCaches(preferredGraphIndex, { resetTelemetry: true, clearCsrReverse: true });
        buildGraphNeighborhood(neighborhoodArgs(false, preferredGraphIndex));
      },
      buildPayload: () => buildGraphNeighborhood(neighborhoodArgs(false, preferredGraphIndex))
    });
    results.neighborhood.includePathsTrue.currentWarm = runWarmPayloadIterations({
      iterations,
      primePayload: () => {
        clearGraphTraversalCaches(preferredGraphIndex, { resetTelemetry: true, clearCsrReverse: true });
        buildGraphNeighborhood(neighborhoodArgs(true, preferredGraphIndex));
      },
      buildPayload: () => buildGraphNeighborhood(neighborhoodArgs(true, preferredGraphIndex))
    });
    results.impact.currentWarm = runWarmPayloadIterations({
      iterations,
      primePayload: () => {
        clearGraphTraversalCaches(preferredGraphIndex, { resetTelemetry: true, clearCsrReverse: true });
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
  const {
    repoRoot,
    indexDir,
    seed,
    iterations,
    depth,
    mode
  } = parseGraphBenchStandardCli(rawArgs, {
    scriptName: 'graph-neighborhood-index-dir'
  });

  const result = await runNeighborhoodIndexDirBench({
    indexDir,
    repoRoot,
    seed,
    iterations,
    depth,
    mode
  });

  printNestedBenchSummaries(result.neighborhood, 'neighborhood');
  printNestedBenchSummaries(result.impact, 'impact');
  console.log(JSON.stringify({ ok: true, result }, null, 2));
  return result;
}

if (isDirectExecution(import.meta.url)) {
  runNeighborhoodIndexDirBenchCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
