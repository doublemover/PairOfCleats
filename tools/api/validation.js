import { compileSchema, createAjv } from '../../src/shared/validation/ajv-factory.js';
import {
  INTEGER_MIN_ZERO_FLAG_FIELDS,
  REPEATED_LIST_FIELDS,
  STRING_FLAG_FIELDS
} from '../shared/search-request.js';

const stringListSchema = {
  anyOf: [
    { type: 'string' },
    { type: 'array', items: { type: 'string' } }
  ]
};

const metaSchema = {
  anyOf: [
    { type: 'string' },
    {
      type: 'array',
      items: {
        anyOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'object' },
          { type: 'null' }
        ]
      }
    },
    { type: 'object', additionalProperties: true }
  ]
};

const stringFieldProperties = Object.fromEntries(
  STRING_FLAG_FIELDS.map(([field]) => [field, { type: 'string' }])
);

const integerMinZeroFieldProperties = Object.fromEntries(
  INTEGER_MIN_ZERO_FLAG_FIELDS.map(([field]) => [field, { type: 'integer', minimum: 0 }])
);

const repeatedListFieldProperties = Object.fromEntries(
  REPEATED_LIST_FIELDS.map(([field]) => [field, stringListSchema])
);

const searchRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1 },
    repoPath: { type: 'string' },
    repo: { type: 'string' },
    asOf: { type: 'string' },
    snapshot: { type: 'string' },
    snapshotId: { type: 'string' },
    output: { type: 'string', enum: ['compact', 'json', 'full'] },
    mode: { type: 'string', enum: ['code', 'prose', 'records', 'both', 'all', 'extracted-prose'] },
    backend: { type: 'string', enum: ['auto', 'memory', 'sqlite', 'sqlite-fts', 'lmdb'] },
    ann: { type: 'boolean' },
    allowSparseFallback: { type: 'boolean' },
    allowUnsafeMix: { type: 'boolean' },
    top: { type: 'integer', minimum: 0 },
    context: { type: 'integer', minimum: 0 },
    ...stringFieldProperties,
    ...integerMinZeroFieldProperties,
    visibility: { type: 'string' },
    extends: { type: 'string' },
    lint: { type: 'boolean' },
    async: { type: 'boolean' },
    generator: { type: 'boolean' },
    returns: { type: 'boolean' },
    case: { type: 'boolean' },
    caseFile: { type: 'boolean' },
    caseTokens: { type: 'boolean' },
    path: stringListSchema,
    paths: stringListSchema,
    ...repeatedListFieldProperties,
    meta: metaSchema,
    metaJson: {
      type: ['string', 'object', 'array', 'number', 'boolean', 'null']
    }
  }
};

const federatedSelectionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    repos: stringListSchema,
    select: stringListSchema,
    tags: stringListSchema,
    tag: stringListSchema,
    repoFilter: stringListSchema,
    'repo-filter': stringListSchema,
    includeDisabled: { type: 'boolean' }
  }
};

const federatedCohortSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    policy: { type: 'string', enum: ['default', 'strict'] },
    cohort: stringListSchema,
    allowUnsafeMix: { type: 'boolean' }
  }
};

const federatedMergeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    strategy: { type: 'string', enum: ['rrf'] },
    rrfK: { type: 'integer', minimum: 1 }
  }
};

const federatedLimitsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    perRepoTop: { type: 'integer', minimum: 0 },
    concurrency: { type: 'integer', minimum: 1 }
  }
};

const federatedDebugSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    includePaths: { type: 'boolean' }
  }
};

const federatedSearchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query', 'workspacePath'],
  properties: {
    workspacePath: { type: 'string', minLength: 1 },
    workspaceId: { type: 'string', minLength: 1 },
    query: { type: 'string', minLength: 1 },
    search: { type: 'object' },
    select: federatedSelectionSchema,
    merge: federatedMergeSchema,
    limits: federatedLimitsSchema,
    cohorts: federatedCohortSchema,
    cohort: stringListSchema,
    allowUnsafeMix: { type: 'boolean' },
    strict: { type: 'boolean' },
    debug: federatedDebugSchema
  }
};

const formatValidationErrors = (errors = []) => errors.map((err) => {
  const path = err.instancePath || '#';
  if (err.keyword === 'additionalProperties') {
    return `${path} has unknown field "${err.params?.additionalProperty}"`;
  }
  if (err.keyword === 'required') {
    return `${path} missing required field "${err.params?.missingProperty}"`;
  }
  return `${path} ${err.message}`.trim();
});

export const createSearchValidator = () => {
  const ajv = createAjv({ allErrors: false, strict: false });
  const validateSearchRequest = compileSchema(ajv, searchRequestSchema);
  return (payload) => {
    const valid = validateSearchRequest(payload);
    if (valid) return { ok: true };
    return { ok: false, errors: formatValidationErrors(validateSearchRequest.errors || []) };
  };
};

export const createFederatedSearchValidator = () => {
  const ajv = createAjv({ allErrors: false, strict: false });
  const validateFederatedSearch = compileSchema(ajv, federatedSearchSchema);
  return (payload) => {
    const valid = validateFederatedSearch(payload);
    if (valid) return { ok: true };
    return { ok: false, errors: formatValidationErrors(validateFederatedSearch.errors || []) };
  };
};
