import { assertCurrentIndexFormat } from '../../../contracts/index-format.js';
import { assertSemanticEnvelope } from '../../../contracts/validators/semantic-envelopes.js';
import { openSemanticCacheEntry } from '../../../index/build/incremental/semantic-cache.js';
import { validateSemanticPartitions } from '../../../index/semantic/reconcile.js';
import { canonicalSemanticJson } from '../../../index/semantic/identity.js';
import { ingestSemanticPartition, removeSemanticSource } from './ingest.js';
import { throwIfAborted } from '../../../shared/abort.js';

const fail = (message) => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });

/** Resolve all source descriptors, including zero-chunk files, before opening a write transaction. */
export const prepareCachedSemanticPlan = async ({ incrementalData, repoRoot = process.cwd(), signal = null }) => {
  const manifest = incrementalData?.manifest;
  assertCurrentIndexFormat({ operation: 'import', component: 'incremental manifest',
    foundVersion: manifest?.artifactSurfaceVersion, repoRoot, indexPath: incrementalData?.manifestPath || incrementalData?.bundleDir || repoRoot });
  const files = Object.entries(manifest.files || {});
  const hasFacts = files.some(([, entry]) => entry?.semanticCache);
  if (!hasFacts && !Object.hasOwn(manifest, 'semanticEnabled')) return null;
  const generation = assertSemanticEnvelope('generation', incrementalData.semanticGeneration || manifest.semanticGeneration);
  const entries = [];
  const partitions = [];
  const stores = new Map();
  const sourceStores = new Map();
  if (manifest.semanticEnabled !== false) {
    for (const [file, entry] of files) {
      throwIfAborted(signal);
      if (!entry?.semanticCache) throw fail('Semantic-enabled manifest is missing source facts for ' + file);
      const opened = await openSemanticCacheEntry({ repoRoot, bundleDir: incrementalData.bundleDir, locator: entry.semanticCache,
        expectedDependencySignatures: manifest.semanticDependencySignatures, signal });
      // Binding the path prevents a manifest entry from borrowing another file's valid facts.
      const sources = [];
      for await (const source of opened.store.iterateRows(opened.factsRef.syntaxPartitionId, 'semantic_sources', { signal })) sources.push(source);
      if (sources.length !== 1 || sources[0].path !== file.split('\\').join('/')) {
        throw fail('Semantic cache source path differs from manifest entry: ' + file);
      }
      entries.push({ file, ...opened });
      for (const partition of opened.factsRef.partitions) {
        if (stores.has(partition.partitionId)) throw fail('Duplicate semantic cache partition identity.');
        stores.set(partition.partitionId, opened.store);
        partitions.push(partition);
      }
      sourceStores.set(opened.factsRef.sourceUnitId, opened.store);
    }
  }
  const store = {
    async *iterateRows(partitionId, member, options) {
      const sourceStore = stores.get(partitionId);
      if (!sourceStore) throw fail('Unknown semantic cache partition.');
      yield* sourceStore.iterateRows(partitionId, member, options);
    },
    async verifySource(source, options) {
      const sourceStore = sourceStores.get(source.sourceUnitId);
      if (!sourceStore) throw fail('Unknown semantic cache source.');
      await sourceStore.verifySource(source, options);
    }
  };
  await validateSemanticPartitions({ store, partitions, signal });
  return { entries, partitions, store, generation, enabled: manifest.semanticEnabled !== false };
};

/** Canonical ingestor shared with artifact builds; caller owns the surrounding whole update. */
export const applyCachedSemanticPlan = async ({ db, plan, signal = null }) => {
  if (!plan) return { changedPartitions: 0, removedSources: 0 };
  if (!db.inTransaction) throw new Error('Semantic cache application requires a caller-owned transaction.');
  const desiredSources = new Set(plan.entries.map(entry => entry.factsRef.sourceUnitId));
  const desiredPartitions = new Map(plan.partitions.map(partition => [partition.partitionId, partition]));
  let removedSources = 0;
  for (const { source_id: sourceUnitId } of db.prepare('SELECT source_id FROM semantic_sources').all()) {
    if (desiredSources.has(sourceUnitId)) continue;
    throwIfAborted(signal);
    removeSemanticSource({ db, sourceUnitId }); removedSources += 1;
  }
  // A removed analysis pass must disappear even when its source remains unchanged.
  const stalePartitions = db.prepare('SELECT partition_id FROM semantic_analysis').all()
    .filter(row => !desiredPartitions.has(row.partition_id));
  for (const { partition_id: partitionId } of stalePartitions) {
    for (const table of ['semantic_records', 'semantic_operands', 'semantic_edges', 'semantic_ownership',
      'semantic_coverage', 'semantic_lookup', 'semantic_frontier', 'semantic_analysis']) {
      db.prepare('DELETE FROM ' + table + ' WHERE partition_id = ?').run(partitionId);
    }
  }
  let changedPartitions = 0;
  for (const descriptor of plan.partitions) {
    throwIfAborted(signal);
    const existing = db.prepare('SELECT canonical_hash FROM semantic_analysis WHERE partition_id = ?').get(descriptor.partitionId);
    if (existing?.canonical_hash === descriptor.canonicalHash) continue;
    await ingestSemanticPartition({ db, store: plan.store, descriptor, signal });
    changedPartitions += 1;
  }
  db.prepare('INSERT OR REPLACE INTO index_format_meta(key,value) VALUES (?,?)')
    .run('semanticGeneration', canonicalSemanticJson(plan.generation));
  throwIfAborted(signal);
  return { changedPartitions, removedSources };
};
