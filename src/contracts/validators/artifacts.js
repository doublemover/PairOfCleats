import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { ARTIFACT_SCHEMA_DEFS } from '../schemas/artifacts.js';

const ajv = createAjv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

export const ARTIFACT_VALIDATORS = Object.fromEntries(
  Object.entries(ARTIFACT_SCHEMA_DEFS).map(([name, schema]) => [name, compileSchema(ajv, schema)])
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
