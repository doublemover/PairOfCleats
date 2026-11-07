import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { FINITE_FEASIBILITY_REQUEST_SCHEMA, FINITE_FEASIBILITY_RESULT_SCHEMA } from '../schemas/finite-feasibility.js';

const validate = compileSchema(createAjv({ strict: true, allErrors: true }), FINITE_FEASIBILITY_REQUEST_SCHEMA);
const validateResult = compileSchema(createAjv({ strict: true, allErrors: true }), FINITE_FEASIBILITY_RESULT_SCHEMA);
export const captureFiniteFeasibilityRequest = input => {
  const captured = captureSemanticRequest(input, FINITE_FEASIBILITY_REQUEST_SCHEMA);
  if (!validate(captured)) throw Object.assign(new TypeError('Invalid finite feasibility request.'), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  return captured;
};
export const assertFiniteFeasibilityResult = result => {
  if (!validateResult(result)) throw Object.assign(new TypeError('Invalid finite feasibility result.'), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  return result;
};
