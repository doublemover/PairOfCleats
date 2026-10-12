import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { SEMANTIC_OPERATION_INDEX_SCHEMA, SEMANTIC_OPERATION_INDEX_ROW_SCHEMA } from '../schemas/semantic-operation-index.js';
const ajv = createAjv({ allErrors: true, strict: true });
const manifest = compileSchema(ajv, SEMANTIC_OPERATION_INDEX_SCHEMA), row = compileSchema(ajv, SEMANTIC_OPERATION_INDEX_ROW_SCHEMA);
export const assertSemanticOperationIndex = (value, { rowOnly = false } = {}) => {
  const validate = rowOnly ? row : manifest;
  if (!validate(value)) throw new TypeError('Invalid semantic operation index: ' + ajv.errorsText(validate.errors));
  if (!rowOnly) {
    let next = 0;
    for (const piece of value.pieces) { if (!piece.count || piece.firstRow !== next) throw new Error('Noncontiguous operation index.'); next += piece.count; }
    if (next !== value.rowCount) throw new Error('Operation index count mismatch.');
  }
  return value;
};
