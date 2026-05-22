import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { BUILD_STATE_SCHEMA } from '../schemas/build-state.js';
import { toValidationResult } from './result.js';

const ajv = createAjv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

const BUILD_STATE_VALIDATOR = compileSchema(ajv, BUILD_STATE_SCHEMA);

export function validateBuildState(payload) {
  return toValidationResult(BUILD_STATE_VALIDATOR, payload);
}
