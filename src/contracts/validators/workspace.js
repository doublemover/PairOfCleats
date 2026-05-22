import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import {
  WORKSPACE_CONFIG_RESOLVED_SCHEMA,
  WORKSPACE_MANIFEST_SCHEMA
} from '../schemas/workspace.js';
import { toValidationResult } from './result.js';

const ajv = createAjv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  dialect: '2020'
});

const VALIDATE_WORKSPACE_CONFIG = compileSchema(ajv, WORKSPACE_CONFIG_RESOLVED_SCHEMA);
const VALIDATE_WORKSPACE_MANIFEST = compileSchema(ajv, WORKSPACE_MANIFEST_SCHEMA);

export const validateWorkspaceConfigResolved = (payload) => (
  toValidationResult(VALIDATE_WORKSPACE_CONFIG, payload)
);

export const validateWorkspaceManifest = (payload) => (
  toValidationResult(VALIDATE_WORKSPACE_MANIFEST, payload)
);
