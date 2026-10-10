import { semanticObject as object, semanticInteger as integer,
  semanticHashSchema as hash, SEMANTIC_GENERATION_SCHEMA, SEMANTIC_PIECE_SCHEMA } from './semantic-envelopes.js';
import { SEMANTIC_RECORD_REF_SCHEMA as ref } from './semantic.js';
const partitionId = ref.properties.partitionId;
const member = { enum: ['semantic_operands', 'semantic_lookup', 'semantic_ownership', 'semantic_records', 'semantic_edges'] };
export const SEMANTIC_QUERY_INDEX_ROW_SCHEMA = object({ owner: ref, member, partitionId, rowOrdinal: integer });
export const SEMANTIC_QUERY_INDEX_SCHEMA = object({
  schemaVersion: { const: 1 }, generation: SEMANTIC_GENERATION_SCHEMA,
  partitionHashes: { type: 'array', items: object({ partitionId, canonicalHash: hash }) },
  pieces: { type: 'array', items: object({ ...SEMANTIC_PIECE_SCHEMA.properties,
    firstKey: SEMANTIC_QUERY_INDEX_ROW_SCHEMA, lastKey: SEMANTIC_QUERY_INDEX_ROW_SCHEMA }) },
  rowCount: integer
});
