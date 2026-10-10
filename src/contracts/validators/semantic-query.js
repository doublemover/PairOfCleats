import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { SEMANTIC_DETAIL_REQUEST_SCHEMA, SEMANTIC_DETAIL_RESULT_SCHEMA } from '../schemas/semantic-query.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validators = {
  detailRequest: compileSchema(ajv, SEMANTIC_DETAIL_REQUEST_SCHEMA),
  detailResult: compileSchema(ajv, SEMANTIC_DETAIL_RESULT_SCHEMA)
};
export const assertSemanticQuery = (kind, value) => {
  const validate = validators[kind];
  if (!validate) throw new TypeError('Unknown semantic query contract: ' + kind);
  if (!validate(value)) throw Object.assign(new TypeError('Invalid semantic query ' + kind + ': ' + ajv.errorsText(validate.errors)),
    { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  if (kind === 'detailResult') {
    for (const row of value.records) {
      if (row.id !== row.ref.localId) throw new TypeError('Semantic projection identity mismatch.');
      for (const field of ['span', 'scope', 'data']) {
        if (Object.hasOwn(row, field) === row.omittedFieldGroups.includes(field)) throw new TypeError('Semantic projection field disclosure mismatch.');
      }
    }
    if (value.coverage.response.returnedCount !== value.records.length) throw new TypeError('Semantic response count mismatch.');
  }
  return value;
};
