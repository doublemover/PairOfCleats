import { createHash } from 'node:crypto';
import { semanticHash, canonicalSemanticJson } from './identity.js';
import { SEMANTIC_MEMBER_NAMES } from '../../contracts/schemas/semantic-envelopes.js';

/** Streaming reconciliation: counts/ranges and every qualified endpoint before publication. */
export const validateSemanticPartitions = async ({ store, partitions, signal = null }) => {
  const sizes = new Map(partitions.map((p) => [p.partitionId,
    p.members.semantic_records.reduce((sum, piece) => sum + piece.count, 0)]));
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
    const actual = semanticHash('pairofcleats.semantic.partition-content.v1', {
      partitionId: partition.partitionId, sourceUnitId: partition.sourceUnitId, producerHash: partition.producerHash,
      contextHash: partition.contextHash, policyHash: partition.policyHash, memberHashes: hashes
    });
    if (actual !== partition.canonicalHash) throw new Error('Semantic canonical content hash mismatch.');
  }
};
