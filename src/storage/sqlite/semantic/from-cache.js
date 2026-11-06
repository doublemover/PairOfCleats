import path from 'node:path';
import { readVerifiedContainedFile } from '../../../shared/contained-file.js';
import { validateEmbeddedCacheSource } from '../../../index/semantic/embedded-cache.js';
import { withPreparedEmbeddedParent } from '../../../index/semantic/embedded-parent.js';
import { assertCurrentIndexFormat } from '../../../contracts/index-format.js';
import { assertSemanticEnvelope } from '../../../contracts/validators/semantic-envelopes.js';
import { openSemanticCacheEntry } from '../../../index/build/incremental/semantic-cache.js';
import { validateSemanticPartitions } from '../../../index/semantic/reconcile.js';
import { canonicalSemanticJson } from '../../../index/semantic/identity.js';
import { ingestSemanticPartition, removeSemanticSource, removeSemanticPartition } from './ingest.js';
import { throwIfAborted } from '../../../shared/abort.js';

const fail = (message) => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });

/** Resolve all source descriptors, including zero-chunk files, before opening a write transaction. */
export const prepareCachedSemanticPlan = async ({ incrementalData, repoRoot = process.cwd(), signal = null,
  diskAccount = null, metrics = null }) => {
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
      const sourceEntries = [{ file, ...opened }];
      if (!Array.isArray(entry.semanticSegmentCaches || [])) throw fail('Invalid semantic segment cache inventory.');
      const segments = entry.semanticSegmentCaches || [];
      if (segments.length) await withPreparedEmbeddedParent({ parentFacts: opened.factsRef,
        parentByteLength: sources[0].byteLength, diskAccount, signal, metrics,
        loadBytes: async () => (await readVerifiedContainedFile(opened.root,
          path.join(opened.root, 'semantic-sources', sources[0].byteHash + '.utf8'),
          { maxBytes: 64 * 1024 * 1024, expectedHash: sources[0].byteHash, expectedBytes: sources[0].byteLength, signal })).buffer
      }, async preparedParent => {
        for (const segment of segments) {
          throwIfAborted(signal);
          if (!segment || typeof segment.segmentUid !== 'string' || !segment.segmentUid) throw fail('Invalid semantic segment cache locator.');
          if (metrics) metrics.childDescriptorOpens = (metrics.childDescriptorOpens || 0) + 1;
          const child = await openSemanticCacheEntry({ repoRoot, bundleDir: incrementalData.bundleDir, locator: segment.locator,
            expectedDependencySignatures: manifest.semanticDependencySignatures, expectedRepositoryNamespace: opened.factsRef.repositoryNamespace, signal });
          await validateEmbeddedCacheSource({ opened: child, parentFacts: opened.factsRef, preparedParent, segmentUid: segment.segmentUid, signal, metrics });
          sourceEntries.push({ file: file + '#semantic-segment:' + child.factsRef.sourceUnitId, ...child });
        }
      });
      for (const openedSource of sourceEntries) {
        entries.push(openedSource);
        for (const partition of openedSource.factsRef.partitions) {
          if (stores.has(partition.partitionId)) throw fail('Duplicate semantic cache partition identity.');
          stores.set(partition.partitionId, openedSource.store);
          partitions.push(partition);
        }
        sourceStores.set(openedSource.factsRef.sourceUnitId, openedSource.store);
      }
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
    removeSemanticPartition({ db, partitionId });
  }
  // Repair derived rows left by older pruning code before publishing this update.
  db.exec('DELETE FROM semantic_discovery WHERE NOT EXISTS (SELECT 1 FROM semantic_analysis a WHERE a.partition_id = semantic_discovery.partition_id)');
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
