import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { MAX_JSON_BYTES } from '../../../src/shared/artifact-io/constants.js';
import { loadPiecesManifest } from '../../../src/shared/artifact-io/manifest.js';
import { createGraphStore, buildGraphIndexCacheKey } from '../../../src/graph/store.js';
import { buildIndexSignature } from '../../../src/retrieval/index-cache.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { isDirectExecution } from '../../../src/shared/direct-execution.js';
import { withContainedFileSync } from '../../../src/shared/contained-file.js';
import { getBakPath } from '../../../src/shared/artifact-io/cache.js';
import { describeStorageFailure } from '../../../src/shared/storage/failure-observation.js';

const fail = message => { throw Object.assign(new Error(message), { code: 'ERR_BENCH_GRAPH_ADMISSION' }); };
const symbolWitness = index => {
  const hash = createHash('sha256'); let occurrences = 0;
  for (const key of [...index.symbolIndex.byChunk.keys()].sort()) {
    hash.update(JSON.stringify(key)); hash.update('\n');
    for (const value of index.symbolIndex.byChunk.get(key)) { hash.update(stableStringify(value)); hash.update('\n'); occurrences++; }
  }
  return { sha256: hash.digest('hex'), occurrences, chunks: index.symbolIndex.byChunk.size, symbols: index.symbolIndex.bySymbol.size };
};

/** Exactly one cold admission/build and one warm hit per fresh process. */
export const collectGraphStoreSample = async ({ indexDir, repoRoot, arm }) => {
  if (!path.isAbsolute(indexDir) || !path.isAbsolute(repoRoot) || !['baseline', 'current'].includes(arm)) throw new TypeError('Invalid graph-store worker request.');
  const started = performance.now();
  const manifest = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  const manifestIdentity = createHash('sha256').update(stableStringify(manifest)).digest('hex');
  const indexSignature = await buildIndexSignature(indexDir);
  const store = createGraphStore({ indexDir, manifest, strict: true, maxBytes: MAX_JSON_BYTES });
  if (!store.hasArtifact('symbol_edges')) return { state: 'unavailable', reason: 'symbol-edges-absent', arm };
  const includeCsr = arm === 'baseline' && store.hasArtifact('graph_relations_csr');
  const graphs = arm === 'baseline' ? ['callGraph', 'usageGraph', 'importGraph', 'symbolEdges'] : ['symbolEdges'];
  const key = buildGraphIndexCacheKey({ indexSignature, repoRoot, graphs, includeCsr });
  const setupMs = performance.now() - started;
  const coldStart = performance.now();
  const cold = await store.loadGraphIndex({ repoRoot, indexSignature, cacheKey: key, graphs, includeCsr });
  const admissionBuildMs = performance.now() - coldStart;
  const coldStats = store.stats(), artifactsUsed = store.getArtifactsUsed().sort();
  if (coldStats.cache.index.hits || coldStats.cache.artifacts.hits || !coldStats.lastBuild
    || coldStats.cache.index.misses !== 1 || coldStats.cache.index.builds !== 1
    || coldStats.cache.artifacts.misses !== 1) fail('Cold graph sample observed prior application cache state.');
  if (arm === 'current' && (artifactsUsed.length !== 1 || artifactsUsed[0] !== 'symbol_edges')) fail('Lazy sample admitted an unrelated artifact.');
  const witness = symbolWitness(cold);
  if (!witness.occurrences) return { state: 'unavailable', reason: 'symbol-task-empty', arm, artifactsUsed };
  const artifactBytes = Object.create(null);
  for (const name of artifactsUsed) {
    const presence = store.resolvePresence(name);
    const files = new Set([...(presence?.paths || []), ...(presence?.metaPath ? [presence.metaPath] : [])]);
    if (!files.size) fail('Used graph artifact has no physical source witness.');
    let total = 0;
    for (const file of files) {
      let stat;
      try { stat = withContainedFileSync(indexDir, file, descriptor => descriptor.stat()); }
      catch (error) {
        if (describeStorageFailure(error, { phase: 'graph-bench-artifact-observation' }).code !== 'ENOENT') throw error;
        stat = withContainedFileSync(indexDir, getBakPath(file), descriptor => descriptor.stat());
      }
      if (!stat.isFile() || !Number.isSafeInteger(stat.size)) fail('Used graph source is not a bounded regular file.');
      total += stat.size;
      if (!Number.isSafeInteger(total)) fail('Used graph source bytes exceed exact accounting.');
    }
    artifactBytes[name] = total;
  }
  const warmStart = performance.now();
  const warm = await store.loadGraphIndex({ repoRoot, indexSignature, cacheKey: key, graphs, includeCsr });
  const warmHitMs = performance.now() - warmStart, warmStats = store.stats();
  if (warm !== cold || warmStats.cache.index.hits !== coldStats.cache.index.hits + 1
    || warmStats.cache.index.misses !== coldStats.cache.index.misses
    || warmStats.cache.index.builds !== coldStats.cache.index.builds
    || warmStats.cache.artifacts.misses !== coldStats.cache.artifacts.misses
    || stableStringify(symbolWitness(warm)) !== stableStringify(witness)) fail('Warm graph sample changed the task or rebuilt its cold index.');
  if (stableStringify(await buildIndexSignature(indexDir)) !== stableStringify(indexSignature)) fail('Selected graph source changed during a sample.');
  if (createHash('sha256').update(stableStringify(loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true }))).digest('hex') !== manifestIdentity) {
    fail('Selected graph manifest changed during a sample.');
  }
  return { state: 'observed', arm, pid: process.pid, indexSignature, manifestIdentity, graphs, includeCsr, artifactsUsed, artifactBytes,
    byteScope: 'observed-on-disk-used-artifact-source-bytes;not-physical-IO', witness,
    setupMs, admissionBuildMs, coldTotalMs: setupMs + admissionBuildMs, warmHitMs,
    completedColdOperations: 1, completedWarmOperations: 1, indexBuildsObserved: coldStats.cache.index.builds,
    coldStats, warmStats, omittedGraphNodes: arm === 'baseline' ? Object.values(coldStats.lastBuild.graph)
      .reduce((total, value) => total + value.nodeCount, 0) : null };
};

if (isDirectExecution(import.meta.url)) {
  try {
    if (!process.argv[2] || Buffer.byteLength(process.argv[2], 'utf8') > 16384) throw new TypeError('Bounded graph-store worker input required.');
    console.log(JSON.stringify(await collectGraphStoreSample(JSON.parse(process.argv[2]))));
  } catch (error) { console.error(error?.stack || error); process.exitCode = 1; }
}
