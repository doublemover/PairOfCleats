import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { FINITE_FEASIBILITY_REQUEST_SCHEMA, FINITE_FEASIBILITY_RESULT_SCHEMA,
  FINITE_FEASIBILITY_CLAIM_REQUEST_SCHEMA, FINITE_FEASIBILITY_CLAIM_SCHEMA } from '../schemas/finite-feasibility.js';

const validate = compileSchema(createAjv({ strict: true, allErrors: true }), FINITE_FEASIBILITY_REQUEST_SCHEMA);
const validateResult = compileSchema(createAjv({ strict: true, allErrors: true }), FINITE_FEASIBILITY_RESULT_SCHEMA);
const validateClaimRequest = compileSchema(createAjv({ strict: true, allErrors: true }), FINITE_FEASIBILITY_CLAIM_REQUEST_SCHEMA);
const validateClaim = compileSchema(createAjv({ strict: true, allErrors: true }), FINITE_FEASIBILITY_CLAIM_SCHEMA);
export const captureFiniteFeasibilityRequest = input => {
  const captured = captureSemanticRequest(input, FINITE_FEASIBILITY_REQUEST_SCHEMA);
  if (!validate(captured)) throw Object.assign(new TypeError('Invalid finite feasibility request.'), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  return captured;
};
export const assertFiniteFeasibilityResult = result => {
  if (!validateResult(result)) throw Object.assign(new TypeError('Invalid finite feasibility result.'), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  return result;
};
export const captureFiniteFeasibilityClaimRequest = input => {
  const result = captureSemanticRequest(input, FINITE_FEASIBILITY_CLAIM_REQUEST_SCHEMA);
  if (!validateClaimRequest(result)) throw Object.assign(new TypeError('Invalid finite feasibility claim scope.'), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  return result;
};
export const assertFiniteFeasibilityClaim = value => {
  if (!validateClaim(value)) throw Object.assign(new TypeError('Invalid checked finite feasibility claim.'), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  return value;
};
