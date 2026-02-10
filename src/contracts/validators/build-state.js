import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { BUILD_STATE_SCHEMA } from '../schemas/build-state.js';

const ajv = createAjv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

const BUILD_STATE_VALIDATOR = compileSchema(ajv, BUILD_STATE_SCHEMA);

const formatError = (error) => {
  const path = error.instancePath || '/';
  const message = error.message || 'schema error';
  return `${path} ${message}`.trim();
};

const formatErrors = (validator) => (
  validator.errors ? validator.errors.map(formatError) : []
);

export function validateBuildState(payload) {
  const ok = Boolean(BUILD_STATE_VALIDATOR(payload));
  return { ok, errors: ok ? [] : formatErrors(BUILD_STATE_VALIDATOR) };
}
