import Ajv from 'ajv';
import { BUILD_STATE_SCHEMA } from '../schemas/build-state.js';

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

const cloneSchema = (schema) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(schema);
  }
  return JSON.parse(JSON.stringify(schema));
};

const BUILD_STATE_VALIDATOR = ajv.compile(cloneSchema(BUILD_STATE_SCHEMA));

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
