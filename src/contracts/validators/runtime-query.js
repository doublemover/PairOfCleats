import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { RUNTIME_QUERY_REQUEST_SCHEMA, RUNTIME_QUERY_RESULT_SCHEMA, RUNTIME_QUERY_CURSOR_SCHEMA,
  RUNTIME_LOOKUP_SERVICE_REQUEST_SCHEMA, RUNTIME_DISCOVERY_SERVICE_REQUEST_SCHEMA, RUNTIME_DISCOVERY_RESULT_SCHEMA } from '../schemas/runtime-query.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validators = { request: compileSchema(ajv, RUNTIME_QUERY_REQUEST_SCHEMA),
  result: compileSchema(ajv, RUNTIME_QUERY_RESULT_SCHEMA), cursor: compileSchema(ajv, RUNTIME_QUERY_CURSOR_SCHEMA),
  lookupRequest: compileSchema(ajv, RUNTIME_LOOKUP_SERVICE_REQUEST_SCHEMA),
  discoveryRequest: compileSchema(ajv, RUNTIME_DISCOVERY_SERVICE_REQUEST_SCHEMA),
  discoveryResult: compileSchema(ajv, RUNTIME_DISCOVERY_RESULT_SCHEMA) };
export const assertRuntimeQuery = (kind, value) => {
  const validate = validators[kind];
  if (!validate || !validate(value)) throw Object.assign(new TypeError('Invalid runtime query ' + kind + ': ' + ajv.errorsText(validate?.errors)),
    { code: 'ERR_RUNTIME_QUERY_CONTRACT' });
  return value;
};
