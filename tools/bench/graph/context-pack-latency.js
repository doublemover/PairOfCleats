#!/usr/bin/env node
import { isDirectExecution } from '../../../src/shared/direct-execution.js';
import { buildGraphIndexCacheKey } from '../../../src/graph/store.js';
import {
  assembleCompositeContextPack,
  buildChunkIndex,
  clearContextPackCaches
} from '../../../src/context-pack/assemble.js';
import {
  clearGraphTraversalCaches,
  durationMs,
  GRAPH_BENCH_GRAPHS,
  loadGraphBenchInputs,
  normalizeCompareMode,
  parseGraphBenchStandardCli,
  printBaselineCurrentSummary,
  runPayloadIterations
} from './shared.js';

export async function runContextPackLatencyBench({
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
    includeCsr,
    chunkMeta,
    graphRelations,
    indexCompatKey,
    indexSignature,
    resolvedSeed
  } = await loadGraphBenchInputs({
    indexDir,
    seed,
    missingSeedMessage: 'Unable to resolve seed for context-pack bench.'
  });

  const graphCacheKey = buildGraphIndexCacheKey({
    indexSignature,
    repoRoot,
    graphs: GRAPH_BENCH_GRAPHS,
    includeCsr
  });
  const graphIndexStart = process.hrtime.bigint();
  const graphIndex = await graphStore.loadGraphIndex({
    repoRoot,
    cacheKey: graphCacheKey,
    graphs: GRAPH_BENCH_GRAPHS,
    includeCsr
  });
  timings.graphIndexColdMs = durationMs(graphIndexStart);

  const graphIndexWarmStart = process.hrtime.bigint();
  await graphStore.loadGraphIndex({
    repoRoot,
    cacheKey: graphCacheKey,
    graphs: GRAPH_BENCH_GRAPHS,
    includeCsr
  });
  timings.graphIndexWarmMs = durationMs(graphIndexWarmStart);

  const chunkIndexStart = process.hrtime.bigint();
  const chunkIndex = buildChunkIndex(chunkMeta, { repoRoot });
  timings.chunkIndexMs = durationMs(chunkIndexStart);

  const assembleArgs = {
    seed: resolvedSeed,
    chunkMeta,
    repoRoot,
    includeGraph: true,
    includeTypes: false,
    includeRisk: false,
    includeImports: true,
    includeUsages: true,
    includeCallersCallees: true,
    includePaths: false,
    depth,
    caps,
    indexCompatKey: indexCompatKey || null,
    indexSignature: indexSignature || null
  };

  const normalizedMode = normalizeCompareMode(mode);
  const results = {};

  if (normalizedMode === 'baseline' || normalizedMode === 'compare') {
    results.baseline = runPayloadIterations({
      iterations,
      buildPayload: () => {
        clearContextPackCaches();
        clearGraphTraversalCaches(graphIndex);
        return assembleCompositeContextPack({
          ...assembleArgs,
          graphRelations,
          graphIndex: null,
          chunkIndex: null
        });
      }
    });
  }

  if (normalizedMode === 'current' || normalizedMode === 'compare') {
    results.current = runPayloadIterations({
      iterations,
      buildPayload: () => assembleCompositeContextPack({
        ...assembleArgs,
        graphRelations: null,
        graphIndex,
        chunkIndex
      })
    });
  }

  const graphStoreStats = graphStore.stats();
  const traversalTelemetry = graphIndex?._traversalTelemetry && typeof graphIndex._traversalTelemetry === 'object'
    ? graphIndex._traversalTelemetry
    : null;
  const traversalCacheSize = graphIndex?._traversalCache?.size || 0;

  return {
    mode: normalizedMode,
    meta: {
      seed: resolvedSeed,
      timings,
      graphStore: graphStoreStats,
      graphStoreArtifactsUsed: graphStore.getArtifactsUsed(),
      csr: {
        available: Boolean(includeCsr),
        used: Boolean(graphIndex?.graphRelationsCsr),
        source: graphStoreStats?.lastBuild?.csrSource || null,
        bytes: graphStoreStats?.lastBuild?.csrBytes || 0
      },
      traversalCache: {
        size: traversalCacheSize,
        telemetry: traversalTelemetry
      }
    },
    ...results
  };
}

export async function runContextPackLatencyBenchCli(rawArgs = process.argv.slice(2)) {
  const {
    repoRoot,
    indexDir,
    seed,
    iterations,
    depth,
    mode
  } = parseGraphBenchStandardCli(rawArgs, {
    scriptName: 'context-pack-latency'
  });

  const result = await runContextPackLatencyBench({
    indexDir,
    repoRoot,
    seed,
    iterations,
    depth,
    mode
  });
  printBaselineCurrentSummary(result);

  console.log(JSON.stringify({ ok: true, result }, null, 2));
  return result;
}

if (isDirectExecution(import.meta.url)) {
  runContextPackLatencyBenchCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
