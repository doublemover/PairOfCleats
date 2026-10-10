import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { SEMANTIC_QUERY_INDEX_SCHEMA, SEMANTIC_QUERY_INDEX_ROW_SCHEMA } from '../schemas/semantic-query-index.js';
const ajv = createAjv({ allErrors: true, strict: true });
const manifest = compileSchema(ajv, SEMANTIC_QUERY_INDEX_SCHEMA);
const row = compileSchema(ajv, SEMANTIC_QUERY_INDEX_ROW_SCHEMA);
export const assertSemanticQueryIndex = (value, { rowOnly = false } = {}) => {
  const validate = rowOnly ? row : manifest;
  if (!validate(value)) throw Object.assign(new TypeError('Invalid semantic query index: ' + ajv.errorsText(validate.errors)), { code: 'ERR_SEMANTIC_QUERY_INDEX' });
  if (!rowOnly) {
    let next = 0;
    for (const piece of value.pieces) {
      if (!piece.count || piece.firstRow !== next) throw new TypeError('Noncontiguous semantic query index pieces.');
      next += piece.count;
    }
    if (next !== value.rowCount || new Set(value.partitionHashes.map(item => item.partitionId)).size !== value.partitionHashes.length) throw new TypeError('Semantic query index inventory mismatch.');
  }
  return value;
};
