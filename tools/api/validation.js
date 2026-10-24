import { buildSearchRequestProperties, createSearchStringListSchema } from '../../src/shared/search-request-schema.js';
import { CONTEXT_TASK_POLICY_SCHEMA } from '../../src/contracts/schemas/context-task.js';
import { validateFederatedSearchAdmission } from '../../src/retrieval/federation/request.js';
import { cloneJsonSchema, compileSchema, createAjv } from '../../src/shared/validation/ajv-factory.js';
import {
  SEARCH_REQUEST_REQUIREMENT,
  buildSearchRequestArgs,
  validateLegacySearchContext
} from '../../src/shared/search-request.js';

const stringListSchema = createSearchStringListSchema();
const searchRequestSchema = {
  type: 'object',
  additionalProperties: false,
  ...SEARCH_REQUEST_REQUIREMENT,
  properties: buildSearchRequestProperties({ includeRepoAlias: true })
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
  required: ['workspacePath'],
  properties: {
    workspacePath: { type: 'string', minLength: 1 },
    workspaceId: { type: 'string', minLength: 1 },
    query: { type: 'string' },
    cursor: { type: 'string', minLength: 1, maxLength: 16384 },
    search: { type: 'object', additionalProperties: false, properties: (() => {
      const properties = buildSearchRequestProperties();
      delete properties.repoPath;
      delete properties.query;
      properties.cursor = { type: 'string', minLength: 1, maxLength: 16384 };
      return properties;
    })() },
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

const contextPackSelectSchema = {
  anyOf: [
    stringListSchema,
    federatedSelectionSchema
  ]
};

const riskFiltersSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rule: stringListSchema,
    category: stringListSchema,
    severity: stringListSchema,
    tag: stringListSchema,
    source: stringListSchema,
    sink: stringListSchema,
    flowId: stringListSchema,
    flow_id: stringListSchema,
    'flow-id': stringListSchema,
    sourceRule: stringListSchema,
    source_rule: stringListSchema,
    'source-rule': stringListSchema,
    sinkRule: stringListSchema,
    sink_rule: stringListSchema,
    'sink-rule': stringListSchema
  }
};

const riskExplainSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['chunk'],
  properties: {
    repoPath: { type: 'string' },
    repo: { type: 'string' },
    chunk: { type: 'string', minLength: 1 },
    max: { type: 'integer', minimum: 1 },
    includePartialFlows: { type: 'boolean' },
    maxPartialFlows: { type: 'integer', minimum: 1 },
    filters: riskFiltersSchema
  }
};

const riskDeltaSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['seed', 'from', 'to'],
  properties: {
    repoPath: { type: 'string' },
    repo: { type: 'string' },
    seed: { type: 'string', minLength: 1 },
    from: { type: 'string', minLength: 1 },
    to: { type: 'string', minLength: 1 },
    includePartialFlows: { type: 'boolean' },
    filters: riskFiltersSchema
  }
};

const contextPackSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['seed', 'hops'],
  properties: {
    repoPath: { type: 'string' },
    repo: { type: 'string' },
    workspacePath: { type: 'string', minLength: 1 },
    workspaceId: { type: 'string', minLength: 1 },
    select: contextPackSelectSchema,
    includeDisabled: { type: 'boolean' },
    maxFederatedRepos: { type: 'integer', minimum: 1 },
    seed: { type: 'string', minLength: 1 },
    hops: { type: 'integer', minimum: 0 },
    includeGraph: { type: 'boolean' },
    includeSemantic: { type: 'boolean' },
    includeTypes: { type: 'boolean' },
    includeRisk: { type: 'boolean' },
    includeRiskPartialFlows: { type: 'boolean' },
    strictRisk: { type: 'boolean' },
    strictEvidence: { type: 'boolean' },
    pathSemantics: { const: 'graph-witness' },
    taskPolicy: CONTEXT_TASK_POLICY_SCHEMA,
    includeImports: { type: 'boolean' },
    includeUsages: { type: 'boolean' },
    includeCallersCallees: { type: 'boolean' },
    includePaths: { type: 'boolean' },
    maxBytes: { type: 'integer', minimum: 0 },
    maxTokens: { type: 'integer', minimum: 0 },
    maxTypeEntries: { type: 'integer', minimum: 0 },
    maxDepth: { type: 'integer', minimum: 0 },
    maxFanoutPerNode: { type: 'integer', minimum: 0 },
    maxNodes: { type: 'integer', minimum: 0 },
    maxEdges: { type: 'integer', minimum: 0 },
    maxPaths: { type: 'integer', minimum: 0 },
    maxCandidates: { type: 'integer', minimum: 0 },
    maxWorkUnits: { type: 'integer', minimum: 0 },
    maxWallClockMs: { type: 'integer', minimum: 0 },
    filters: riskFiltersSchema
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

/** An owned description for native clients; callers cannot mutate validation. */
export const getSearchRequestSchema = () => cloneJsonSchema(searchRequestSchema);

export const createSearchValidator = () => {
  const ajv = createAjv({ allErrors: false, strict: false });
  const validateSearchRequest = compileSchema(ajv, searchRequestSchema);
  return (payload) => {
    if (payload && typeof payload === 'object') {
      const context = validateLegacySearchContext(payload);
      if (!context.ok) return { ok: false, errors: [context.message] };
    }
    const valid = validateSearchRequest(payload);
    if (valid) {
      const request = buildSearchRequestArgs(payload);
      return request.ok ? { ok: true } : { ok: false, errors: [request.message] };
    }
    return { ok: false, errors: formatValidationErrors(validateSearchRequest.errors || []) };
  };
};

export const createFederatedSearchValidator = () => {
  const ajv = createAjv({ allErrors: false, strict: false });
  const validateFederatedSearch = compileSchema(ajv, federatedSearchSchema);
  return (payload) => {
    const valid = validateFederatedSearch(payload);
    if (valid) return validateFederatedSearchAdmission(payload);
    return { ok: false, errors: formatValidationErrors(validateFederatedSearch.errors || []) };
  };
};

export const createRiskExplainValidator = () => {
  const ajv = createAjv({ allErrors: false, strict: false });
  const validateRiskExplain = compileSchema(ajv, riskExplainSchema);
  return (payload) => {
    const valid = validateRiskExplain(payload);
    if (valid) return { ok: true };
    return { ok: false, errors: formatValidationErrors(validateRiskExplain.errors || []) };
  };
};

export const createRiskDeltaValidator = () => {
  const ajv = createAjv({ allErrors: false, strict: false });
  const validateRiskDelta = compileSchema(ajv, riskDeltaSchema);
  return (payload) => {
    const valid = validateRiskDelta(payload);
    if (valid) return { ok: true };
    return { ok: false, errors: formatValidationErrors(validateRiskDelta.errors || []) };
  };
};

export const createContextPackValidator = () => {
  const ajv = createAjv({ allErrors: false, strict: false });
  const validateContextPack = compileSchema(ajv, contextPackSchema);
  return (payload) => {
    const valid = validateContextPack(payload);
    if (valid) return { ok: true };
    return { ok: false, errors: formatValidationErrors(validateContextPack.errors || []) };
  };
};
