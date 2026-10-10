import { semanticHash } from './identity.js';
import { SEMANTIC_MEMBER_NAMES } from '../../contracts/schemas/semantic-envelopes.js';
import { assertSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';

export const semanticFileContentHash = ({ sourceUnitId, partitions }) => semanticHash('pairofcleats.semantic.file-content.v1', {
  sourceUnitId, partitions: partitions.map(({ partitionId, canonicalHash }) => ({ partitionId, canonicalHash }))
    .sort((a, b) => a.partitionId.localeCompare(b.partitionId))
});
/** Portable descriptor only: storage is relative to one immutable build, never the worker cwd. */
export const createSemanticFactsRef = ({ source, partitions, syntaxPartitionId, storage, coverage }) => {
  const syntax = partitions.find((partition) => partition.partitionId === syntaxPartitionId);
  if (!syntax) throw new Error('Missing syntax partition in semantic file descriptor.');
  const counts = Object.fromEntries(SEMANTIC_MEMBER_NAMES.map((member) => [member,
    partitions.reduce((total, partition) => total + partition.members[member].reduce((sum, piece) => sum + piece.count, 0), 0)]));
  const result = { schemaVersion: 1, repositoryNamespace: source.repositoryNamespace,
    sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, syntaxPartitionId,
    extractionHash: syntax.canonicalHash, canonicalHash: semanticFileContentHash({ sourceUnitId: source.sourceUnitId, partitions }),
    storage, partitions, counts, coverage };
  return assertSemanticEnvelope('fileFactsRef', result);
};
