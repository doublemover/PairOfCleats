import { createHash } from 'node:crypto';
import { semanticHash, canonicalSemanticJson } from './identity.js';
import { SEMANTIC_MEMBER_NAMES } from '../../contracts/schemas/semantic-envelopes.js';
import { throwIfAborted } from '../../shared/abort.js';

/** Read-only seed admission for the narrow summary-demand planner. The actual
 * store's closed generation/partition readers own source authority, not a span
 * or current worktree path supplied by the request.
 */
export const reconcileCompilerSummaryDemandSeed = async ({ store, request, signal = null }) => {
  throwIfAborted(signal);
  request = JSON.parse(canonicalSemanticJson(request, { maxBytes: 16384, check: () => throwIfAborted(signal) }));
  if (store?.backend !== 'artifact' || typeof store.cursorScope !== 'string'
    || typeof store.getRecords !== 'function' || typeof store.getSourceReference !== 'function') {
    return { compatible: false, reason: 'artifact_summary_demand_store_required' };
  }
  const generation = canonicalSemanticJson(store.generation), inventoryHash = store.cursorScope;
  const getRecords = store.getRecords.bind(store), getSourceReference = store.getSourceReference.bind(store);
  if (generation !== canonicalSemanticJson(request.generation) || inventoryHash !== request.inventoryHash) {
    return { compatible: false, reason: 'summary_demand_generation_or_inventory_changed' };
  }
  const [record] = await getRecords([request.seed], ['span'], { signal });
  throwIfAborted(signal);
  if (!record || !['declaration', 'expression'].includes(record.kind) || !record.span) {
    return { compatible: false, reason: 'summary_demand_seed_kind_unsupported' };
  }
  const source = await getSourceReference(record, { signal });
  throwIfAborted(signal);
  if (!source || source.sourceUnitId !== request.sourceUnitId || source.sourceHash !== request.sourceHash) {
    return { compatible: false, reason: 'summary_demand_source_changed_or_mapped' };
  }
  return { compatible: true, recordKind: record.kind, source: { sourceUnitId: source.sourceUnitId,
    sourceHash: source.sourceHash, path: source.path } };
};

/** Streaming reconciliation: counts/ranges and every qualified endpoint before publication. */
export const validateSemanticPartitions = async ({ store, partitions, referencePartitions = partitions, signal = null }) => {
  const sizes = new Map(referencePartitions.map((p) => [p.partitionId,
    p.members.semantic_records.reduce((sum, piece) => sum + piece.count, 0)]));
  const verifiedSources = new Set();
  for (const partition of partitions) {
    const hashes = {};
    const checkRef = (ref) => {
      if (!ref || !Object.hasOwn(ref, 'partitionId')) return;
      if (!sizes.has(ref.partitionId) || ref.localId >= sizes.get(ref.partitionId)) {
        throw new Error('Dangling semantic reference: ' + canonicalSemanticJson(ref));
      }
    };
    let source = null;
    let nodeId = 0;
    for (const member of SEMANTIC_MEMBER_NAMES) {
      const hash = createHash('sha256');
      let count = 0;
      for await (const row of store.iterateRows(partition.partitionId, member, { signal })) {
        hash.update(canonicalSemanticJson(row)).update('\n'); count += 1;
        if (member === 'semantic_sources') {
          if (source || row.sourceUnitId !== partition.sourceUnitId) throw new Error('Invalid semantic source ownership.');
          source = row;
        }
        if (member === 'semantic_frontier' && !row.sourceUnits.includes(partition.sourceUnitId)) {
          throw new Error('Semantic frontier/source ownership mismatch.');
        }
        if (member === 'semantic_records') {
          if (row.id !== nodeId++) throw new Error('Noncontiguous semantic node identity.');
          if (row.span && (!source || row.span[1] > source.textLength)) throw new Error('Semantic source range mismatch.');
          checkRef(row.scope);
          for (const key of ['parent', 'owner', 'initializer', 'typeSyntax', 'expression', 'occurrence', 'site', 'storage', 'invocation']) checkRef(row.data[key]);
        } else for (const key of ['parent', 'child', 'from', 'to', 'callSite', 'condition', 'evidence', 'recordRef', 'scope']) checkRef(row[key]);
      }
      if (count !== partition.members[member].reduce((sum, piece) => sum + piece.count, 0)) throw new Error('Semantic count mismatch.');
      hashes[member] = hash.digest('hex');
    }
    if (!source) throw new Error('Missing semantic source manifest.');
    const sourceKey = canonicalSemanticJson(source);
    if (!verifiedSources.has(sourceKey)) {
      await store.verifySource(source, { signal });
      verifiedSources.add(sourceKey);
    }
    const actual = semanticHash('pairofcleats.semantic.partition-content.v1', {
      partitionId: partition.partitionId, sourceUnitId: partition.sourceUnitId, producerHash: partition.producerHash,
      contextHash: partition.contextHash, policyHash: partition.policyHash, memberHashes: hashes
    });
    if (actual !== partition.canonicalHash) throw new Error('Semantic canonical content hash mismatch.');
  }
};
