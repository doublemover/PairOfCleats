import { semanticObject as object, semanticInteger as integer, semanticText as text, SEMANTIC_PIECE_SCHEMA } from './semantic-envelopes.js';
import { SEMANTIC_QUERY_INDEX_SCHEMA } from './semantic-query-index.js';
import { SEMANTIC_RECORD_REF_SCHEMA as ref } from './semantic.js';
export const SEMANTIC_OPERATION_INDEX_ROW_SCHEMA = object({ field: { enum: ['astKind', 'operation', 'invocationKind'] }, value: text, ref });
export const SEMANTIC_OPERATION_INDEX_SCHEMA = { ...SEMANTIC_QUERY_INDEX_SCHEMA, properties: { ...SEMANTIC_QUERY_INDEX_SCHEMA.properties,
  pieces: { type: 'array', items: object({ ...SEMANTIC_PIECE_SCHEMA.properties, firstKey: SEMANTIC_OPERATION_INDEX_ROW_SCHEMA, lastKey: SEMANTIC_OPERATION_INDEX_ROW_SCHEMA }) }, rowCount: integer } };
