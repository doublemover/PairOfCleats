import { normalizeCapNullOnZero } from '../../../shared/limits.js';
import { pickMinLimit } from './limits.js';
import { LANGUAGE_CAPS_BASELINES } from './caps-calibration.js';

const CLIKE_CAPS_BASELINE = LANGUAGE_CAPS_BASELINES.clike || {};
const DEFAULT_OBJECTIVEC_CAPS_BY_EXT = Object.freeze({
  '.m': Object.freeze({
    maxBytes: normalizeCapNullOnZero(CLIKE_CAPS_BASELINE.maxBytes, null),
    maxLines: normalizeCapNullOnZero(CLIKE_CAPS_BASELINE.maxLines, null)
  }),
  '.mm': Object.freeze({
    maxBytes: normalizeCapNullOnZero(CLIKE_CAPS_BASELINE.maxBytes, null),
    maxLines: normalizeCapNullOnZero(CLIKE_CAPS_BASELINE.maxLines, null)
  })
});

const DEFAULT_EXTENSION_CAPS = Object.freeze({
  '.js': Object.freeze({ maxBytes: 320 * 1024, maxLines: 5200 }),
  '.mjs': Object.freeze({ maxBytes: 320 * 1024, maxLines: 5200 }),
  '.cjs': Object.freeze({ maxBytes: 320 * 1024, maxLines: 5200 }),
  '.ts': Object.freeze({ maxBytes: 384 * 1024, maxLines: 6500 }),
  '.mts': Object.freeze({ maxBytes: 384 * 1024, maxLines: 6500 }),
  '.cts': Object.freeze({ maxBytes: 384 * 1024, maxLines: 6500 }),
  '.jsx': Object.freeze({ maxBytes: 256 * 1024, maxLines: 3600 }),
  '.tsx': Object.freeze({ maxBytes: 288 * 1024, maxLines: 4200 }),
  '.vue': Object.freeze({ maxBytes: 256 * 1024, maxLines: 3500 }),
  '.svelte': Object.freeze({ maxBytes: 224 * 1024, maxLines: 3200 }),
  '.astro': Object.freeze({ maxBytes: 256 * 1024, maxLines: 3600 })
});

/**
 * Normalize a numeric cap value to a non-negative integer.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export const normalizeLimit = (value, fallback) => (
  normalizeCapNullOnZero(value, fallback)
);

/**
 * Normalize a depth-like cap value.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export const normalizeDepth = (value, fallback) => {
  if (value === 0) return 0;
  if (value === false) return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return fallback;
};

/**
 * Normalize a ratio (0..1) value.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export const normalizeRatio = (value, fallback) => {
  if (value === undefined || value === null || value === false) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
};

const normalizeCapValue = (value) => (
  normalizeCapNullOnZero(value, null)
);

/**
 * Normalize a cap entry object.
 * @param {object} raw
 * @returns {object}
 */
export const normalizeCapEntry = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const maxBytes = normalizeCapValue(input.maxBytes);
  const maxLines = normalizeCapValue(input.maxLines);
  return { maxBytes, maxLines };
};

/**
 * Normalize caps keyed by file extension.
 * @param {object} raw
 * @returns {object}
 */
export const normalizeCapsByExt = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    const entry = normalizeCapEntry(value);
    if (entry.maxBytes == null && entry.maxLines == null) continue;
    const normalizedKey = key.startsWith('.') ? key.toLowerCase() : `.${key.toLowerCase()}`;
    output[normalizedKey] = entry;
  }
  return output;
};

/**
 * Normalize caps keyed by language id.
 * @param {object} raw
 * @returns {object}
 */
export const normalizeCapsByLanguage = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    const entry = normalizeCapEntry(value);
    if (entry.maxBytes == null && entry.maxLines == null) continue;
    output[key.toLowerCase()] = entry;
  }
  return output;
};

/**
 * Normalize caps keyed by mode.
 * @param {object} raw
 * @returns {object}
 */
export const normalizeCapsByMode = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const output = {};
  const allowed = new Set(['code', 'prose', 'extracted-prose', 'records']);
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = String(key || '').trim().toLowerCase();
    if (!allowed.has(normalizedKey)) continue;
    const entry = normalizeCapEntry(value);
    if (entry.maxBytes == null && entry.maxLines == null) continue;
    output[normalizedKey] = entry;
  }
  return output;
};

/**
 * Normalize an optional limit (null/undefined means unset).
 * @param {unknown} value
 * @returns {number|null}
 */
export const normalizeOptionalLimit = (value) => {
  if (value === 0 || value === false) return null;
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};

/**
 * Normalize tree-sitter caps keyed by language.
 * @param {object} raw
 * @returns {object}
 */
export const normalizeTreeSitterByLanguage = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    const entry = value && typeof value === 'object' ? value : {};
    const maxBytes = normalizeCapValue(entry.maxBytes);
    const maxLines = normalizeCapValue(entry.maxLines);
    const maxParseMs = normalizeOptionalLimit(entry.maxParseMs);
    if (maxBytes == null && maxLines == null && maxParseMs == null) continue;
    output[key.toLowerCase()] = { maxBytes, maxLines, maxParseMs };
  }
  return output;
};

/**
 * Resolve file cap configuration and guardrails from indexing config.
 * @param {object} indexingConfig
 * @returns {{fileCaps:object,guardrails:object}}
 */
export const resolveFileCapsAndGuardrails = (indexingConfig) => {
  const maxFileBytes = normalizeLimit(indexingConfig.maxFileBytes, 5 * 1024 * 1024);
  const fileCapsConfig = indexingConfig.fileCaps || {};
  const defaultByLanguageCaps = {};
  for (const [languageId, entry] of Object.entries(LANGUAGE_CAPS_BASELINES)) {
    defaultByLanguageCaps[languageId] = normalizeCapEntry(entry);
  }
  const byLanguageOverrides = normalizeCapsByLanguage(fileCapsConfig.byLanguage || {});
  const mergedByLanguageCaps = { ...defaultByLanguageCaps };
  for (const [languageId, override] of Object.entries(byLanguageOverrides)) {
    const baseline = mergedByLanguageCaps[languageId] || { maxBytes: null, maxLines: null };
    mergedByLanguageCaps[languageId] = {
      maxBytes: override.maxBytes != null ? override.maxBytes : baseline.maxBytes,
      maxLines: override.maxLines != null ? override.maxLines : baseline.maxLines
    };
  }
  const fileCaps = {
    default: normalizeCapEntry(fileCapsConfig.default || {}),
    byExt: normalizeCapsByExt(fileCapsConfig.byExt || {}),
    byLanguage: mergedByLanguageCaps,
    byMode: normalizeCapsByMode(fileCapsConfig.byMode || {})
  };
  for (const [ext, entry] of Object.entries(DEFAULT_OBJECTIVEC_CAPS_BY_EXT)) {
    if (fileCaps.byExt[ext]) continue;
    fileCaps.byExt[ext] = { ...entry };
  }
  for (const [ext, entry] of Object.entries(DEFAULT_EXTENSION_CAPS)) {
    if (fileCaps.byExt[ext]) continue;
    fileCaps.byExt[ext] = { ...entry };
  }
  const untrustedConfig = indexingConfig.untrusted || {};
  const untrustedEnabled = untrustedConfig.enabled === true;
  const untrustedDefaults = {
    maxFileBytes: 1024 * 1024,
    maxLines: 10000,
    maxFiles: 100000,
    maxDepth: 25
  };
  const untrustedMaxFileBytes = normalizeLimit(untrustedConfig.maxFileBytes, untrustedDefaults.maxFileBytes);
  const untrustedMaxLines = normalizeLimit(untrustedConfig.maxLines, untrustedDefaults.maxLines);
  const untrustedMaxFiles = normalizeLimit(untrustedConfig.maxFiles, untrustedDefaults.maxFiles);
  const untrustedMaxDepth = normalizeDepth(untrustedConfig.maxDepth, untrustedDefaults.maxDepth);
  let guardrails = {
    enabled: false,
    maxFiles: null,
    maxDepth: null,
    maxFileBytes: null,
    maxLines: null
  };
  let resolvedMaxFileBytes = maxFileBytes;
  const clampEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    return {
      maxBytes: pickMinLimit(entry.maxBytes, untrustedMaxFileBytes),
      maxLines: pickMinLimit(entry.maxLines, untrustedMaxLines)
    };
  };
  if (untrustedEnabled) {
    guardrails = {
      enabled: true,
      maxFiles: untrustedMaxFiles,
      maxDepth: untrustedMaxDepth,
      maxFileBytes: untrustedMaxFileBytes,
      maxLines: untrustedMaxLines
    };
    const nextMaxFileBytes = pickMinLimit(resolvedMaxFileBytes, untrustedMaxFileBytes);
    if (nextMaxFileBytes != null) {
      resolvedMaxFileBytes = nextMaxFileBytes;
    }
    fileCaps.default = clampEntry(fileCaps.default);
    for (const key of Object.keys(fileCaps.byExt)) {
      fileCaps.byExt[key] = clampEntry(fileCaps.byExt[key]);
    }
    for (const key of Object.keys(fileCaps.byLanguage)) {
      fileCaps.byLanguage[key] = clampEntry(fileCaps.byLanguage[key]);
    }
    for (const key of Object.keys(fileCaps.byMode)) {
      fileCaps.byMode[key] = clampEntry(fileCaps.byMode[key]);
    }
  }
  return { maxFileBytes: resolvedMaxFileBytes, fileCaps, guardrails };
};
