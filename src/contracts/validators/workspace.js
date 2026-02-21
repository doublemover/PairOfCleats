import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import {
  WORKSPACE_CONFIG_RESOLVED_SCHEMA,
  WORKSPACE_MANIFEST_SCHEMA
} from '../schemas/workspace.js';

const ajv = createAjv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  dialect: '2020'
});

const VALIDATE_WORKSPACE_CONFIG = compileSchema(ajv, WORKSPACE_CONFIG_RESOLVED_SCHEMA);
const VALIDATE_WORKSPACE_MANIFEST = compileSchema(ajv, WORKSPACE_MANIFEST_SCHEMA);

const formatError = (error) => {
  const path = error.instancePath || '/';
  const message = error.message || 'schema error';
  return `${path} ${message}`.trim();
};

const toResult = (validator, payload) => {
  const ok = Boolean(validator(payload));
  return {
    ok,
    errors: ok || !validator.errors ? [] : validator.errors.map(formatError)
  };
};

export const validateWorkspaceConfigResolved = (payload) => (
  toResult(VALIDATE_WORKSPACE_CONFIG, payload)
);

export const validateWorkspaceManifest = (payload) => (
  toResult(VALIDATE_WORKSPACE_MANIFEST, payload)
);
