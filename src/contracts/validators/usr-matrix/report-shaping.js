import { USR_REPORT_SCHEMA_DEFS } from '../../schemas/usr.js';

export const normalizeReportScope = (scope, fallbackScopeType = 'lane', fallbackScopeId = 'ci') => (
  scope && typeof scope === 'object'
    ? {
      scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : fallbackScopeType,
      scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : fallbackScopeId
    }
    : { scopeType: fallbackScopeType, scopeId: fallbackScopeId }
);

export const buildMatrixRegistryFailureResult = (validation) => ({
  ok: false,
  errors: Object.freeze([...(Array.isArray(validation?.errors) ? validation.errors : [])]),
  warnings: Object.freeze([]),
  rows: Object.freeze([])
});

export const buildReportStatus = ({ errors = [], warnings = [] } = {}) => (
  errors.length > 0
    ? 'fail'
    : (warnings.length > 0 ? 'warn' : 'pass')
);

export const buildReportFindings = (messages, findingClass) => (
  messages.map((message) => ({
    class: findingClass,
    message
  }))
);

export const appendPrefixedRowDiagnostics = ({
  errors,
  warnings,
  rowErrors = [],
  rowWarnings = [],
  messagePrefix = ''
} = {}) => {
  const prefix = typeof messagePrefix === 'string' && messagePrefix.length > 0
    ? `${messagePrefix} `
    : '';

  if (rowErrors.length > 0) {
    errors.push(...rowErrors.map((message) => `${prefix}${message}`));
  }
  if (rowWarnings.length > 0) {
    warnings.push(...rowWarnings.map((message) => `${prefix}${message}`));
  }
};

export const freezeRowDiagnostics = ({ errors = [], warnings = [] } = {}) => ({
  errors: Object.freeze([...errors]),
  warnings: Object.freeze([...warnings])
});

export const cloneRowsWithDiagnostics = (rows) => rows.map((row) => ({
  ...row,
  errors: row.errors,
  warnings: row.warnings
}));

export const buildReportPayload = ({
  schemaVersion = 'usr-1.0.0',
  artifactId,
  generatedAt,
  producerId,
  producerVersion,
  runId,
  lane,
  buildId,
  status,
  scope,
  summary,
  blockingFindings,
  advisoryFindings,
  rows
}) => ({
  schemaVersion,
  artifactId,
  generatedAt,
  producerId,
  producerVersion,
  runId,
  lane,
  buildId,
  status,
  scope,
  summary,
  blockingFindings,
  advisoryFindings,
  rows
});

export const toIsoDate = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp);
};

export const toFixedDays = (ms) => Number((ms / (24 * 60 * 60 * 1000)).toFixed(2));

export const buildKnownCompensatingArtifacts = ({ ownershipRows = [] } = {}) => {
  const known = new Set(
    Object.keys(USR_REPORT_SCHEMA_DEFS).map((artifactId) => `${artifactId}.json`)
  );
  for (const row of ownershipRows) {
    for (const evidenceArtifact of Array.isArray(row?.evidenceArtifacts) ? row.evidenceArtifacts : []) {
      if (typeof evidenceArtifact === 'string' && evidenceArtifact.trim()) {
        known.add(evidenceArtifact);
      }
    }
  }
  return known;
};
