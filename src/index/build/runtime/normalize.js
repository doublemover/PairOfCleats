import path from 'node:path';
import { toPosix } from '../../../shared/files.js';
import { isPathUnderDir } from '../../../shared/path-normalize.js';

export const normalizeParser = (raw, fallback, allowed) => {
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return allowed.includes(normalized) ? normalized : fallback;
};

export const normalizeFlowSetting = (raw) => {
  if (raw === true) return 'on';
  if (raw === false) return 'off';
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return ['auto', 'on', 'off'].includes(normalized) ? normalized : 'auto';
};

const readNested = (source, keyPath) => {
  if (!source || typeof source !== 'object') return undefined;
  let current = source;
  for (const key of keyPath) {
    if (!current || typeof current !== 'object' || !(key in current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
};

const PARSER_NORMALIZATION_TABLE = Object.freeze([
  Object.freeze({
    id: 'javascript',
    topLevelKey: 'javascriptParser',
    nestedPath: Object.freeze(['javascript', 'parser']),
    fallback: 'babel',
    allowed: Object.freeze(['auto', 'babel', 'acorn', 'esprima'])
  }),
  Object.freeze({
    id: 'typescript',
    topLevelKey: 'typescriptParser',
    nestedPath: Object.freeze(['typescript', 'parser']),
    fallback: 'auto',
    allowed: Object.freeze(['auto', 'typescript', 'babel', 'heuristic'])
  })
]);

const FLOW_NORMALIZATION_TABLE = Object.freeze([
  Object.freeze({
    id: 'javascript',
    topLevelKey: 'javascriptFlow',
    nestedPath: Object.freeze(['javascript', 'flow']),
    fallback: 'auto'
  })
]);

/**
 * Normalize per-language parser selections from nested config keys while
 * preserving legacy top-level overrides for compatibility.
 *
 * @param {object} [indexingConfig={}]
 * @returns {Record<string,string>}
 */
export const normalizeLanguageParserConfig = (indexingConfig = {}) => {
  const resolved = {};
  for (const row of PARSER_NORMALIZATION_TABLE) {
    const nestedValue = readNested(indexingConfig, row.nestedPath);
    const topLevelValue = indexingConfig?.[row.topLevelKey];
    const raw = nestedValue !== undefined ? nestedValue : topLevelValue;
    resolved[row.id] = normalizeParser(raw, row.fallback, row.allowed);
  }
  return resolved;
};

/**
 * Normalize Flow enablement flags from nested/legacy config fields.
 *
 * @param {object} [indexingConfig={}]
 * @returns {Record<string,'auto'|'on'|'off'>}
 */
export const normalizeLanguageFlowConfig = (indexingConfig = {}) => {
  const resolved = {};
  for (const row of FLOW_NORMALIZATION_TABLE) {
    const nestedValue = readNested(indexingConfig, row.nestedPath);
    const topLevelValue = indexingConfig?.[row.topLevelKey];
    const raw = nestedValue !== undefined ? nestedValue : topLevelValue;
    resolved[row.id] = normalizeFlowSetting(raw ?? row.fallback);
  }
  return resolved;
};

const resolvePath = (value) => path.resolve(String(value || ''));

const normalizeAbsolutePathForSignature = (value) => {
  const normalized = path.normalize(value);
  if (process.platform !== 'win32') return normalized;
  return normalized.replace(/^[A-Z]:/, (drive) => drive.toLowerCase());
};

const toPosixRelative = (from, to) => {
  const relative = path.relative(from, to);
  if (!relative || relative === '.') return '';
  return toPosix(relative);
};

/**
 * Normalize dictionary file paths into stable signature keys.
 *
 * Preference order:
 * 1. Relative to configured dictionary directory.
 * 2. Relative to repository root.
 * 3. Normalized absolute path (with Windows drive letter normalization).
 *
 * @param {{dictFile:string,dictDir?:string|null,repoRoot:string}} input
 * @returns {string}
 */
export const normalizeDictSignaturePath = ({ dictFile, dictDir, repoRoot }) => {
  const normalized = resolvePath(dictFile);
  if (dictDir) {
    const normalizedDictDir = resolvePath(dictDir);
    if (isPathUnderDir(normalizedDictDir, normalized)) {
      return toPosixRelative(normalizedDictDir, normalized);
    }
  }
  const normalizedRepoRoot = resolvePath(repoRoot);
  if (isPathUnderDir(normalizedRepoRoot, normalized)) {
    return toPosixRelative(normalizedRepoRoot, normalized);
  }
  return toPosix(normalizeAbsolutePathForSignature(normalized));
};
