import { USR_REPORT_SCHEMA_DEFS } from '../../schemas/usr.js';

export const normalizeReportScope = (scope, fallbackScopeType = 'lane', fallbackScopeId = 'ci') => (
  scope && typeof scope === 'object'
    ? {
      scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : fallbackScopeType,
      scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : fallbackScopeId
    }
    : { scopeType: fallbackScopeType, scopeId: fallbackScopeId }
);

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
