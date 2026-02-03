import { buildRecordId } from '../record-utils.js';

/**
 * Normalize a severity string.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSeverity(value) {
  if (typeof value !== 'string') return 'unknown';
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return 'unknown';
  return trimmed;
}

/**
 * Return the first non-empty value from a list.
 * @param {...unknown} values
 * @returns {string|null}
 */
export function pickFirst(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/**
 * Convert a value into an ISO timestamp, or null.
 * @param {unknown} value
 * @returns {string|null}
 */
export function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Resolve routing metadata onto a record.
 * @param {object} record
 * @param {object} meta
 * @param {string} repoRoot
 * @returns {void}
 */
export function applyRoutingMeta(record, meta, repoRoot) {
  if (!record || typeof record !== 'object') return;
  const metaObj = meta && typeof meta === 'object' ? meta : {};
  const assign = (key, value) => {
    if (typeof value === 'string' && value.trim()) record[key] = value.trim();
  };
  assign('service', metaObj.service);
  assign('env', metaObj.env);
  assign('team', metaObj.team);
  assign('owner', metaObj.owner);
  assign('repo', metaObj.repo || repoRoot);
}

/**
 * Build a base record scaffold with routing and timestamps.
 * @param {object} options
 * @param {string} options.source
 * @param {string} options.recordType
 * @param {object} options.meta
 * @param {string} options.repoRoot
 * @param {string|null} options.createdAt
 * @param {string|null} options.updatedAt
 * @returns {object}
 */
export function buildBaseRecord({ source, recordType, meta, repoRoot, createdAt, updatedAt }) {
  const now = new Date().toISOString();
  const record = {
    recordId: null,
    recordType,
    source,
    createdAt: createdAt || now,
    updatedAt: updatedAt || createdAt || now,
    service: null,
    env: null,
    team: null,
    owner: null,
    repo: null
  };
  applyRoutingMeta(record, meta, repoRoot);
  return record;
}

/**
 * Ensure the record has a stable recordId, with warnings on fallbacks.
 * @param {object} record
 * @param {string} source
 * @param {string|null} stableKey
 * @param {unknown} raw
 * @param {string[]} warnings
 * @returns {void}
 */
export function ensureRecordId(record, source, stableKey, raw, warnings) {
  if (!record || typeof record !== 'object' || record.recordId) return;
  let key = stableKey;
  if (!key) {
    const fallback = raw && typeof raw === 'object' ? safeStringifyFallback(raw) : String(raw ?? 'unknown');
    key = fallback || 'unknown';
    if (Array.isArray(warnings)) warnings.push('missing stable key; using raw payload hash');
  }
  record.recordId = buildRecordId(source, key);
}

const MAX_FALLBACK_BYTES = 16384;

const capStringBytes = (value, maxBytes) => {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.length <= maxBytes) return value;
  return buffer.subarray(0, maxBytes).toString('utf8');
};

const safeStringifyFallback = (value) => {
  const seen = new WeakSet();
  try {
    const text = JSON.stringify(value, (key, entry) => {
      if (entry && typeof entry === 'object') {
        if (seen.has(entry)) return '[Circular]';
        seen.add(entry);
      }
      return entry;
    });
    if (!text) return null;
    return capStringBytes(text, MAX_FALLBACK_BYTES);
  } catch {
    return null;
  }
};

/**
 * Normalize an input into a string array.
 * @param {unknown} value
 * @param {string[]} fallback
 * @returns {string[]}
 */
export function normalizeStringArray(value, fallback = []) {
  if (!value) return fallback;
  const output = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) output.push(entry.trim());
      if (entry && typeof entry === 'object') {
        const fromObj = pickFirst(entry.id, entry.cwe_id, entry.cweId, entry.url, entry.name);
        if (fromObj) output.push(fromObj);
      }
    }
  } else if (typeof value === 'string' && value.trim()) {
    output.push(value.trim());
  }
  return output.length ? output : fallback;
}

/**
 * Normalize references into a list of URLs.
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeReferences(value) {
  if (!value) return [];
  const refs = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) refs.push(entry.trim());
      if (entry && typeof entry === 'object') {
        const url = pickFirst(entry.url, entry.href, entry.link);
        if (url) refs.push(url);
      }
    }
  } else if (typeof value === 'string' && value.trim()) {
    refs.push(value.trim());
  }
  return refs;
}

/**
 * Normalize a boolean-ish value.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return null;
    if (['true', 'yes', 'y', '1'].includes(trimmed)) return true;
    if (['false', 'no', 'n', '0'].includes(trimmed)) return false;
  }
  return null;
}

/**
 * Normalize exposure metadata from raw payload or meta overrides.
 * @param {object} raw
 * @param {object} meta
 * @returns {object|null}
 */
export function normalizeExposure(raw, meta = {}) {
  const rawObj = raw && typeof raw === 'object' ? raw : {};
  const exposureRaw = (rawObj.exposure && typeof rawObj.exposure === 'object') ? rawObj.exposure : {};
  const metaObj = meta && typeof meta === 'object' ? meta : {};
  const readMeta = (key) => {
    if (Object.prototype.hasOwnProperty.call(metaObj, key)) return metaObj[key];
    const dotted = `exposure.${key}`;
    if (Object.prototype.hasOwnProperty.call(metaObj, dotted)) return metaObj[dotted];
    return undefined;
  };

  const internetMeta = readMeta('internetExposed') ?? readMeta('internet_exposed');
  const internetRaw = exposureRaw.internetExposed ?? exposureRaw.internet_exposed ?? rawObj.internetExposed ?? rawObj.internet_exposed;
  const internetExposed = parseBoolean(internetMeta ?? internetRaw);

  const publicEndpoint = pickFirst(
    readMeta('publicEndpoint'),
    readMeta('public_endpoint'),
    exposureRaw.publicEndpoint,
    exposureRaw.public_endpoint,
    rawObj.publicEndpoint,
    rawObj.public_endpoint
  );
  const dataSensitivity = pickFirst(
    readMeta('dataSensitivity'),
    readMeta('data_sensitivity'),
    exposureRaw.dataSensitivity,
    exposureRaw.data_sensitivity,
    rawObj.dataSensitivity,
    rawObj.data_sensitivity
  );
  const businessCriticality = pickFirst(
    readMeta('businessCriticality'),
    readMeta('business_criticality'),
    exposureRaw.businessCriticality,
    exposureRaw.business_criticality,
    rawObj.businessCriticality,
    rawObj.business_criticality
  );

  const controlsRaw = readMeta('compensatingControls')
    ?? readMeta('compensating_controls')
    ?? exposureRaw.compensatingControls
    ?? exposureRaw.compensating_controls
    ?? rawObj.compensatingControls
    ?? rawObj.compensating_controls;
  let compensatingControls = normalizeStringArray(controlsRaw);
  if (typeof controlsRaw === 'string') {
    const splitControls = controlsRaw
      .split(/[,;]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (splitControls.length > 1) compensatingControls = splitControls;
  }

  const exposure = {};
  if (internetExposed !== null) exposure.internetExposed = internetExposed;
  if (publicEndpoint) exposure.publicEndpoint = publicEndpoint;
  if (dataSensitivity) exposure.dataSensitivity = dataSensitivity;
  if (businessCriticality) exposure.businessCriticality = businessCriticality;
  if (compensatingControls.length) exposure.compensatingControls = compensatingControls;

  return Object.keys(exposure).length ? exposure : null;
}
