import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { GRAPH_EVIDENCE_REQUEST_SCHEMA, GRAPH_EVIDENCE_RESULT_SCHEMA } from '../schemas/graph-evidence.js';
const ajv = createAjv({ strict: true, allErrors: true, allowUnionTypes: true });
const validators = { request: compileSchema(ajv, GRAPH_EVIDENCE_REQUEST_SCHEMA, { lazy: true }),
  result: compileSchema(ajv, GRAPH_EVIDENCE_RESULT_SCHEMA, { lazy: true }) };
export const assertGraphEvidence = (kind, value) => {
  const validate = validators[kind];
  if (!validate) throw new TypeError('Unknown graph evidence contract.');
  if (!validate(value)) throw Object.assign(new TypeError('Invalid graph evidence ' + kind + ': ' + ajv.errorsText(validate.errors)),
    { code: kind === 'request' ? 'ERR_GRAPH_EVIDENCE_CONTRACT' : 'ERR_GRAPH_EVIDENCE_OUTPUT' });
  if (kind === 'result' && (value.done !== (value.cursor === null) || value.coverage.complete !== value.done)) {
    throw Object.assign(new Error('Graph evidence continuation/coverage mismatch.'), { code: 'ERR_GRAPH_EVIDENCE_OUTPUT' });
  }
  return value;
};
