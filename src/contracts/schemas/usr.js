const STRING = { type: 'string' };
const BOOL = { type: 'boolean' };

const NULLABLE_STRING = {
  type: ['string', 'null']
};

const SCOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scopeType', 'scopeId'],
  properties: {
    scopeType: {
      type: 'string',
      enum: ['global', 'lane', 'language', 'framework']
    },
    scopeId: STRING
  }
};

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: true
};

export const USR_CANONICAL_ID_SCHEMA = {
  type: 'string',
  pattern: '^[a-z][a-z0-9]*(?::[A-Za-z0-9._-]+)+$'
};

export const USR_REPORT_STATUS_SCHEMA = {
  type: 'string',
  enum: ['pass', 'warn', 'fail', 'error', 'partial']
};

export const USR_EVIDENCE_ENVELOPE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'usr-evidence-envelope',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'artifactId',
    'generatedAt',
    'producerId',
    'runId',
    'lane',
    'buildId',
    'status',
    'scope'
  ],
  properties: {
    schemaVersion: STRING,
    artifactId: STRING,
    generatedAt: STRING,
    producerId: STRING,
    producerVersion: NULLABLE_STRING,
    runId: STRING,
    lane: STRING,
    buildId: NULLABLE_STRING,
    status: USR_REPORT_STATUS_SCHEMA,
    scope: SCOPE_SCHEMA,
    blockingFindings: {
      type: 'array',
      items: FINDING_SCHEMA
    },
    advisoryFindings: {
      type: 'array',
      items: FINDING_SCHEMA
    },
    evidenceRefs: {
      type: 'array',
      items: STRING
    }
  }
};

const reportSchema = (artifactId) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: `${artifactId}-report`,
  type: 'object',
  additionalProperties: false,
  required: [
    ...USR_EVIDENCE_ENVELOPE_SCHEMA.required,
    'summary',
    'rows'
  ],
  properties: {
    ...USR_EVIDENCE_ENVELOPE_SCHEMA.properties,
    artifactId: {
      type: 'string',
      const: artifactId
    },
    summary: {
      type: 'object',
      additionalProperties: true
    },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true
      }
    }
  }
});

export const USR_REPORT_SCHEMA_DEFS = Object.freeze({
  'usr-conformance-summary': reportSchema('usr-conformance-summary'),
  'usr-validation-report': reportSchema('usr-validation-report'),
  'usr-waiver-active-report': reportSchema('usr-waiver-active-report'),
  'usr-waiver-expiry-report': reportSchema('usr-waiver-expiry-report'),
  'usr-benchmark-summary': reportSchema('usr-benchmark-summary'),
  'usr-benchmark-regression-summary': reportSchema('usr-benchmark-regression-summary'),
  'usr-observability-rollup': reportSchema('usr-observability-rollup'),
  'usr-threat-model-coverage-report': reportSchema('usr-threat-model-coverage-report'),
  'usr-failure-injection-report': reportSchema('usr-failure-injection-report'),
  'usr-quality-evaluation-results': reportSchema('usr-quality-evaluation-results'),
  'usr-quality-regression-report': reportSchema('usr-quality-regression-report'),
  'usr-release-readiness-scorecard': reportSchema('usr-release-readiness-scorecard'),
  'usr-operational-readiness-validation': reportSchema('usr-operational-readiness-validation'),
  'usr-backcompat-matrix-results': reportSchema('usr-backcompat-matrix-results'),
  'usr-drift-report': reportSchema('usr-drift-report'),
  'usr-release-train-readiness': reportSchema('usr-release-train-readiness'),
  'usr-no-cut-decision-log': reportSchema('usr-no-cut-decision-log'),
  'usr-post-cutover-stabilization-report': reportSchema('usr-post-cutover-stabilization-report'),
  'usr-rollback-drill-report': reportSchema('usr-rollback-drill-report'),
  'usr-incident-response-drill-report': reportSchema('usr-incident-response-drill-report'),
  'usr-feature-flag-state': reportSchema('usr-feature-flag-state')
});

export const USR_DIAGNOSTIC_CODE_SCHEMA = {
  type: 'string',
  pattern: '^USR-[EWI]-[A-Z0-9-]+$'
};

export const USR_REASON_CODE_SCHEMA = {
  type: 'string',
  pattern: '^USR-R-[A-Z0-9-]+$'
};

export const USR_CAPABILITY_STATE_SCHEMA = {
  type: 'string',
  enum: ['supported', 'partial', 'unsupported']
};

export const USR_CAPABILITY_TRANSITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'to', 'diagnostic'],
  properties: {
    from: USR_CAPABILITY_STATE_SCHEMA,
    to: USR_CAPABILITY_STATE_SCHEMA,
    diagnostic: {
      type: 'string',
      enum: ['USR-W-CAPABILITY-DOWNGRADED', 'USR-E-CAPABILITY-LOST']
    },
    reasonCode: USR_REASON_CODE_SCHEMA
  }
};

export const USR_SCHEMA_DEFS = Object.freeze({
  'usr-evidence-envelope': USR_EVIDENCE_ENVELOPE_SCHEMA,
  ...USR_REPORT_SCHEMA_DEFS,
  'usr-capability-transition': USR_CAPABILITY_TRANSITION_SCHEMA
});
