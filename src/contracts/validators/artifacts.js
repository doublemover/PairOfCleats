import Ajv from 'ajv';
import { ARTIFACT_SCHEMA_DEFS } from '../schemas/artifacts.js';

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

export const ARTIFACT_VALIDATORS = Object.fromEntries(
  Object.entries(ARTIFACT_SCHEMA_DEFS).map(([name, schema]) => [name, ajv.compile(cloneSchema(schema))])
);

const formatError = (error) => {
  const path = error.instancePath || '/';
  const message = error.message || 'schema error';
  return `${path} ${message}`.trim();
};

export function validateArtifact(name, data) {
  const validator = ARTIFACT_VALIDATORS[name];
  if (!validator) return { ok: true, errors: [] };
  const ok = Boolean(validator(data));
  const errors = ok || !validator.errors
    ? []
    : validator.errors.map(formatError);
  return { ok, errors };
}
