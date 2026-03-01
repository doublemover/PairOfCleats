import { isPlainObject } from '../../shared/config.js';

/**
 * Normalize command arg input into a deterministic string list.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export const normalizeCommandArgs = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
};

/**
 * Ensure a token exists exactly once in command args.
 *
 * @param {unknown} args
 * @param {string} token
 * @param {{position?:'append'|'prepend'}} [options]
 * @returns {string[]}
 */
export const ensureCommandArgToken = (args, token, options = {}) => {
  const normalized = normalizeCommandArgs(args);
  const target = String(token || '').trim();
  if (!target) return normalized;
  const hasToken = normalized.some((entry) => entry.toLowerCase() === target.toLowerCase());
  if (hasToken) return normalized;
  return options.position === 'prepend'
    ? [target, ...normalized]
    : [...normalized, target];
};

/**
 * Ensure an argument pair (`token value`) exists in command args.
 * If `token` exists with a missing value, the missing value is filled.
 *
 * @param {unknown} args
 * @param {string} token
 * @param {string} value
 * @param {{position?:'append'|'prepend'}} [options]
 * @returns {string[]}
 */
export const ensureCommandArgPair = (args, token, value, options = {}) => {
  const normalized = normalizeCommandArgs(args);
  const target = String(token || '').trim();
  const resolvedValue = String(value || '').trim();
  if (!target || !resolvedValue) return normalized;
  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized[i].toLowerCase() !== target.toLowerCase()) continue;
    if (normalized[i + 1]) return normalized;
    const output = normalized.slice();
    output.splice(i + 1, 0, resolvedValue);
    return output;
  }
  return options.position === 'prepend'
    ? [target, resolvedValue, ...normalized]
    : [...normalized, target, resolvedValue];
};

/**
 * Filter target records to those with a virtualPath present in `documents`.
 *
 * @param {unknown} targets
 * @param {unknown} documents
 * @returns {Array<any>}
 */
export const filterTargetsForDocuments = (targets, documents) => {
  if (!Array.isArray(targets) || !targets.length) return [];
  if (!Array.isArray(documents) || !documents.length) return [];
  const docPaths = new Set(
    documents
      .map((doc) => String(doc?.virtualPath || ''))
      .filter(Boolean)
  );
  if (!docPaths.size) return [];
  return targets.filter((target) => docPaths.has(String(target?.virtualPath || '')));
};

export { isPlainObject };
