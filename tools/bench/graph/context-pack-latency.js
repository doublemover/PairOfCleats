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
  loadGraphRelations,
  loadPiecesManifest,
  readCompatibilityKey
} from '../../../src/shared/artifact-io.js';
import { buildIndexSignature } from '../../../src/retrieval/index-cache.js';
import { buildGraphIndexCacheKey, createGraphStore } from '../../../src/graph/store.js';
import { assembleCompositeContextPack, buildChunkIndex } from '../../../src/context-pack/assemble.js';

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

export async function runContextPackLatencyBench({
  indexDir,
  repoRoot,
  seed,
  iterations = 5,
  depth = 2,
  caps = {}
}) {
  const manifest = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  const chunkMeta = await loadChunkMeta(indexDir, { maxBytes: MAX_JSON_BYTES, manifest, strict: true });
  const graphRelations = await loadGraphRelations(indexDir, { maxBytes: MAX_JSON_BYTES, manifest, strict: true });
  const chunkIndex = buildChunkIndex(chunkMeta, { repoRoot });
  const { key: indexCompatKey } = readCompatibilityKey(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  const indexSignature = await buildIndexSignature(indexDir);
  const graphStore = createGraphStore({ indexDir, manifest, strict: true, maxBytes: MAX_JSON_BYTES });
  const includeCsr = graphStore.hasArtifact('graph_relations_csr');
  const graphCacheKey = buildGraphIndexCacheKey({
    indexSignature,
    repoRoot,
    graphs: ['callGraph', 'usageGraph', 'importGraph'],
    includeCsr
  });
  const graphIndex = await graphStore.loadGraphIndex({
    repoRoot,
    cacheKey: graphCacheKey,
    graphs: ['callGraph', 'usageGraph', 'importGraph'],
    includeCsr
  });

  const resolvedSeed = seed || resolveDefaultSeed(chunkMeta);
  if (!resolvedSeed) {
    throw new Error('Unable to resolve seed for context-pack bench.');
  }

  const timings = [];
  const rssValues = [];
  for (let i = 0; i < iterations; i += 1) {
    const payload = assembleCompositeContextPack({
      seed: resolvedSeed,
      chunkMeta,
      chunkIndex,
      repoRoot,
      graphIndex,
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
    });
    const elapsed = Number(payload?.stats?.timing?.elapsedMs || 0);
    const rss = Number(payload?.stats?.memory?.peak?.rss || 0);
    timings.push(elapsed);
    rssValues.push(rss);
  }

  return {
    iterations,
    timingMs: summarize(timings),
    rssBytes: summarize(rssValues)
  };
}

export async function runContextPackLatencyBenchCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'context-pack-latency',
    argv: ['node', 'context-pack-latency', ...rawArgs],
    options: {
      index: { type: 'string' },
      repo: { type: 'string' },
      seed: { type: 'string' },
      iterations: { type: 'number', default: 5 },
      depth: { type: 'number', default: 2 }
    }
  });
  const argv = cli.parse();

  const repoRoot = argv.repo ? path.resolve(argv.repo) : process.cwd();
  const indexDir = argv.index ? path.resolve(argv.index) : null;
  if (!indexDir || !fs.existsSync(indexDir)) {
    throw new Error('Missing --index <indexDir>.');
  }

  const seed = argv.seed ? parseSeedRef(argv.seed, repoRoot) : null;
  const iterations = normalizeOptionalNumber(argv.iterations) || 5;
  const depth = normalizeOptionalNumber(argv.depth) || 2;

  const result = await runContextPackLatencyBench({
    indexDir,
    repoRoot,
    seed,
    iterations,
    depth
  });
  console.log(JSON.stringify({ ok: true, result }, null, 2));
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runContextPackLatencyBenchCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
