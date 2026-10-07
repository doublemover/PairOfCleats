import { compileSchema, createAjv } from '../../../shared/validation/ajv-factory.js';
import {
  USR_MATRIX_SCHEMA_DEFS,
  USR_MATRIX_ROW_SCHEMAS
} from '../../schemas/usr-matrix.js';
import { toValidationResult } from '../result.js';

const ajv = createAjv({
  dialect: '2020',
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

export const USR_MATRIX_VALIDATORS = Object.freeze(
  Object.fromEntries(
    Object.entries(USR_MATRIX_SCHEMA_DEFS).map(([registryId, schema]) => [registryId, compileSchema(ajv, schema)])
  )
);

export function validateUsrMatrixRegistry(registryId, payload) {
  const validator = USR_MATRIX_VALIDATORS[registryId];
  if (!validator) {
    return { ok: false, errors: [`unknown USR matrix registry: ${registryId}`] };
  }
  return toValidationResult(validator, payload);
}

export function validateUsrMatrixFile(fileName, payload) {
  const registryId = fileName.endsWith('.json')
    ? fileName.slice(0, -'.json'.length)
    : fileName;
  return validateUsrMatrixRegistry(registryId, payload);
}

export function listUsrMatrixRegistryIds() {
  return Object.freeze([...Object.keys(USR_MATRIX_ROW_SCHEMAS)].sort());
}
