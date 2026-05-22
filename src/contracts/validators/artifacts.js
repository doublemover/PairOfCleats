import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { ARTIFACT_SCHEMA_DEFS } from '../schemas/artifacts.js';
import { toValidationResult } from './result.js';

const ajv = createAjv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

export const ARTIFACT_VALIDATORS = Object.fromEntries(
  Object.entries(ARTIFACT_SCHEMA_DEFS).map(([name, schema]) => [name, compileSchema(ajv, schema)])
);

export function validateArtifact(name, data) {
  const validator = ARTIFACT_VALIDATORS[name];
  if (!validator) return { ok: true, errors: [] };
  return toValidationResult(validator, data);
}
