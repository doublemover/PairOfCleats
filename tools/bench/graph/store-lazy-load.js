#!/usr/bin/env node
import { isDirectExecution } from '../../../src/shared/direct-execution.js';
import { MAX_JSON_BYTES } from '../../../src/shared/artifact-io/constants.js';
import { loadPiecesManifest } from '../../../src/shared/artifact-io/manifest.js';
import { buildIndexSignature } from '../../../src/retrieval/index-cache.js';
import { createGraphStore, buildGraphIndexCacheKey } from '../../../src/graph/store.js';
import {
  GRAPH_BENCH_GRAPHS,
  normalizeCompareMode,
  parseGraphIndexBenchCli,
  printBaselineCurrentSummary,
  readNumberArg,
  runAsyncTimedIterations
} from './shared.js';

export async function runGraphStoreBench({ indexDir, repoRoot, iterations, mode }) {
  const manifest = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  const indexSignature = await buildIndexSignature(indexDir);
  const graphStore = createGraphStore({ indexDir, manifest, strict: true, maxBytes: MAX_JSON_BYTES });
  const includeCsr = graphStore.hasArtifact('graph_relations_csr');
  const graphCacheKeyAll = buildGraphIndexCacheKey({
    indexSignature,
    repoRoot,
    graphs: GRAPH_BENCH_GRAPHS,
    includeCsr
  });
  const graphCacheKeySubset = buildGraphIndexCacheKey({
    indexSignature,
    repoRoot,
    graphs: ['callGraph'],
    includeCsr
  });
  const normalizedMode = normalizeCompareMode(mode);
  const results = {};

  if (normalizedMode === 'baseline' || normalizedMode === 'compare') {
    results.baseline = await runAsyncTimedIterations({
      iterations,
      run: () => graphStore.loadGraphIndex({
        repoRoot,
        cacheKey: graphCacheKeyAll,
        graphs: GRAPH_BENCH_GRAPHS,
        includeCsr
      })
    });
  }

  if (normalizedMode === 'current' || normalizedMode === 'compare') {
    results.current = await runAsyncTimedIterations({
      iterations,
      run: () => graphStore.loadGraphIndex({
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
  const { argv, repoRoot, indexDir } = parseGraphIndexBenchCli(rawArgs, {
    scriptName: 'graph-store-lazy-load',
    options: {
      iterations: { type: 'number', default: 3 },
      mode: { type: 'string', default: 'compare' }
    }
  });
  const iterations = readNumberArg(argv.iterations, 3);
  const mode = argv.mode || 'compare';

  const result = await runGraphStoreBench({ indexDir, repoRoot, iterations, mode });

  printBaselineCurrentSummary(result);

  console.log(JSON.stringify({ ok: true, result }, null, 2));
  return result;
}

if (isDirectExecution(import.meta.url)) {
  runGraphStoreBenchCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
