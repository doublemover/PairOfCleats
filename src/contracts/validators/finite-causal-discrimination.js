import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { FINITE_CAUSAL_DISCRIMINATION_SCHEMA } from '../schemas/finite-causal-discrimination.js';
const validate = compileSchema(createAjv({ strict: true, allErrors: true }), FINITE_CAUSAL_DISCRIMINATION_SCHEMA);
export const assertFiniteCausalDiscrimination = value => {
  if (!validate(value)) throw Object.assign(new TypeError('Invalid finite causal discrimination request.'), { code: 'ERR_FINITE_CAUSAL_DISCRIMINATION_CONTRACT' }); return value;
};
