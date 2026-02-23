import { USR_REPORT_SCHEMA_DEFS } from '../../schemas/usr.js';

export const WAIVER_SCOPE_TYPES = Object.freeze(new Set([
  'global',
  'lane',
  'language',
  'framework',
  'artifact',
  'phase'
]));

export const WAIVER_APPROVER_PATTERN = /^(usr|language|framework)-[a-z0-9][a-z0-9-]*$/;
export const WAIVER_EXPIRY_WARNING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const DISALLOWED_WAIVER_CLASSES = Object.freeze(new Set([
  'strict-security-bypass',
  'schema-hard-block-bypass'
]));

const asStringArray = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string')
    : []
);

/**
 * Parse an ISO-like timestamp string to a Date.
 *
 * Failure contract: returns `null` when parsing fails; never throws.
 *
 * @param {unknown} value
 * @returns {Date|null}
 */
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

export const buildKnownUsrArtifactIds = () => new Set(Object.keys(USR_REPORT_SCHEMA_DEFS));

/**
 * Build known compensating evidence artifact filenames from schema/report ownership.
 *
 * Failure contract: returns an empty set when rows are missing; never throws.
 *
 * @param {{ownershipRows?:Array<object>}} [input]
 * @returns {Set<string>}
 */
export const buildKnownCompensatingArtifacts = ({ ownershipRows = [] } = {}) => {
  const known = new Set(
    Object.keys(USR_REPORT_SCHEMA_DEFS).map((artifactId) => `${artifactId}.json`)
  );
  for (const row of ownershipRows) {
    for (const evidenceArtifact of asStringArray(row.evidenceArtifacts)) {
      known.add(evidenceArtifact);
    }
  }
  return known;
};

/**
 * Collect approver roles that are treated as governance-authoritative.
 *
 * @param {{ownershipRows?:Array<object>, escalationRows?:Array<object>}} [input]
 * @returns {Set<string>}
 */
export const buildGovernanceApprovers = ({
  ownershipRows = [],
  escalationRows = []
} = {}) => {
  const governanceApprovers = new Set();
  for (const row of ownershipRows) {
    if (typeof row.ownerRole === 'string') {
      governanceApprovers.add(row.ownerRole);
    }
    if (typeof row.backupOwnerRole === 'string') {
      governanceApprovers.add(row.backupOwnerRole);
    }
  }
  for (const row of escalationRows) {
    for (const approver of asStringArray(row.requiredApprovers)) {
      governanceApprovers.add(approver);
    }
  }
  return governanceApprovers;
};
