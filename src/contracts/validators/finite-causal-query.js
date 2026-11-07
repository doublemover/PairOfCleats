import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { FINITE_CAUSAL_QUERY_SCHEMAS } from '../schemas/finite-causal-query.js';
const ajv = createAjv({ strict: true, allErrors: true });
const validators = Object.fromEntries(Object.entries(FINITE_CAUSAL_QUERY_SCHEMAS).map(([kind, schema]) => [kind, compileSchema(ajv, schema)]));
export const assertFiniteCausalQuery = (kind, value) => {
  if (!validators[kind]?.(value)) throw Object.assign(new TypeError('Invalid finite causal ' + kind + '.'), { code: 'ERR_FINITE_CAUSAL_QUERY_CONTRACT' });
  return value;
};
