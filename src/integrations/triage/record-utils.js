import crypto from 'node:crypto';

const PROMOTED_FIELD_PATHS = {
  vulnId: ['vuln', 'vulnId'],
  cve: ['vuln', 'cve'],
  packageName: ['package', 'name'],
  packageEcosystem: ['package', 'ecosystem'],
  severity: ['vuln', 'severity'],
  status: ['decision', 'status'],
  assetId: ['asset', 'assetId']
};

/** Canonical collection with legacy singleton compatibility. */
export const getRecordPackages = record => Array.isArray(record?.packages)
  ? record.packages.filter(pkg => pkg && typeof pkg === 'object')
  : record?.package && typeof record.package === 'object' ? [record.package] : [];

/** Snapshot the finding's admitted package occurrences for a manual decision.
 * The compatibility representative is separate from the canonical collection;
 * legacy records remain readable without manufacturing occurrence identities.
 * @param {object} finding
 * @returns {{package:object|null,packages:object[]}}
 */
export const snapshotFindingPackages = finding => ({
  package: finding?.package ? structuredClone(finding.package) : null,
  packages: structuredClone(getRecordPackages(finding))
});

/**
 * Build a stable record id from a source and stable key.
 * @param {string} source
 * @param {string} stableKey
 * @returns {string}
 */
export function buildRecordId(source, stableKey) {
  const safeSource = String(source || 'unknown').trim();
  const safeKey = String(stableKey || 'unknown').trim();
  return crypto.createHash('sha1').update(`${safeSource}:${safeKey}`).digest('hex');
}

/**
 * Select promoted record fields for doc metadata.
 * @param {object} record
 * @param {string[]} promoteFields
 * @returns {object}
 */
export function promoteRecordFields(record, promoteFields) {
  if (!record || typeof record !== 'object') return {};
  const fields = Array.isArray(promoteFields) ? promoteFields : [];
  const output = {};
  for (const field of fields) {
    const value = resolvePromotedValue(record, field);
    if (isValuePresent(value)) output[field] = value;
  }
  return output;
}

/**
 * Resolve a value for a promoted field.
 * @param {object} record
 * @param {string} field
 * @returns {unknown}
 */
function resolvePromotedValue(record, field) {
  if (!record || typeof record !== 'object') return undefined;
  if (field === 'packageName' || field === 'packageEcosystem') {
    const key = field === 'packageName' ? 'name' : 'ecosystem';
    const values = [...new Set(getRecordPackages(record).map(pkg => pkg[key]).filter(isValuePresent))];
    if (values.length) return values.length === 1 ? values[0] : values;
  }
  const path = PROMOTED_FIELD_PATHS[field];
  if (path) {
    const nested = getNestedValue(record, path);
    if (isValuePresent(nested)) return nested;
  }
  if (Object.prototype.hasOwnProperty.call(record, field)) {
    return record[field];
  }
  return undefined;
}

/**
 * Retrieve a nested value by path.
 * @param {object} record
 * @param {string[]} pathParts
 * @returns {unknown}
 */
function getNestedValue(record, pathParts) {
  let current = record;
  for (const part of pathParts) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Check if a value should be preserved in promoted fields.
 * @param {unknown} value
 * @returns {boolean}
 */
function isValuePresent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
