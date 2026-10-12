import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { SEMANTIC_TRACE_REQUEST_SCHEMA, SEMANTIC_TRACE_RESULT_SCHEMA } from '../schemas/semantic-trace.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validators = { request: compileSchema(ajv, SEMANTIC_TRACE_REQUEST_SCHEMA), result: compileSchema(ajv, SEMANTIC_TRACE_RESULT_SCHEMA) };
export const assertSemanticTrace = (kind, value) => {
  const validate = validators[kind];
  if (!validate) throw new TypeError('Unknown semantic trace contract: ' + kind);
  if (!validate(value)) throw Object.assign(new TypeError('Invalid semantic trace ' + kind + ': ' + ajv.errorsText(validate.errors)), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  if (kind === 'result') {
    if (value.coverage.response.returnedCount !== value.records.length) throw new TypeError('Semantic response count mismatch.');
    for (const row of value.records) {
      if (row.id !== row.ref.localId) throw new TypeError('Semantic projection identity mismatch.');
      for (const field of ['span', 'scope', 'data']) if (Object.hasOwn(row, field) === row.omittedFieldGroups.includes(field)) throw new TypeError('Semantic projection field disclosure mismatch.');
    }
  }
  return value;
};
