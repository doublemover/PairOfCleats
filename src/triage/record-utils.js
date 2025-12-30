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
