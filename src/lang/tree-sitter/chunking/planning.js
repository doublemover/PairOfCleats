import { treeSitterState } from '../state.js';

export const QUERY_CAPTURE_NAME = 'chunk';
export const QUERY_MATCH_LIMIT_BUFFER = 32;

const PRIMARY_EXTENSION_LANGUAGE_MAP = new Map([
  ['.tsx', 'tsx'],
  ['.jsx', 'jsx'],
  ['.ts', 'typescript'],
  ['.cts', 'typescript'],
  ['.mts', 'typescript'],
  ['.js', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.jsm', 'javascript'],
  ['.py', 'python'],
  ['.json', 'json'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
  ['.toml', 'toml'],
  ['.xml', 'xml'],
  ['.md', 'markdown'],
  ['.mdx', 'markdown']
]);

const SECONDARY_EXTENSION_LANGUAGE_MAP = new Map([
  ['.m', 'objc'],
  ['.mm', 'objc'],
  ['.cpp', 'cpp'],
  ['.cc', 'cpp'],
  ['.cxx', 'cpp'],
  ['.hpp', 'cpp'],
  ['.hh', 'cpp'],
  ['.c', 'clike'],
  ['.h', 'clike']
]);

/**
 * Build a capture query pattern for declaration-like nodes.
 *
 * Deduplication preserves insertion order from `typeNodes` followed by
 * `memberNodes`, so query capture order remains deterministic.
 *
 * @param {object|null} language
 * @param {object|null} config
 * @returns {string|null}
 */
const buildChunkQueryPattern = (language, config) => {
  if (!config) return null;
  const types = new Set();
  for (const entry of config.typeNodes || []) types.add(entry);
  for (const entry of config.memberNodes || []) types.add(entry);
  if (!types.size) return null;

  const filtered = [];
  const hasLookup = language && typeof language.idForNodeType === 'function';
  for (const type of types) {
    if (!hasLookup) {
      filtered.push(type);
      continue;
    }
    const typeId = language.idForNodeType(type, true);
    if (typeId !== null && typeId !== undefined) filtered.push(type);
  }

  if (!filtered.length) return null;
  return filtered.map((type) => `(${type}) @${QUERY_CAPTURE_NAME}`).join('\n');
};

/**
 * Resolve and memoize the compiled query used by chunk extraction.
 *
 * Query compile failures are memoized as `null` to avoid repeated compile work
 * and repeated error logs for grammars that do not support a given pattern.
 *
 * @param {string} languageId
 * @param {object} config
 * @param {object} options
 * @param {(key:string,amount?:number)=>void|null} [bumpMetric=null]
 * @returns {object|null}
 */
export const getTreeSitterChunkQuery = (languageId, config, options, bumpMetric = null) => {
  if (!languageId || !config) return null;
  if (options?.treeSitter?.useQueries === false) return null;

  const cache = treeSitterState.queryCache;
  if (cache?.has?.(languageId)) {
    if (typeof bumpMetric === 'function') bumpMetric('queryHits', 1);
    return cache.get(languageId);
  }

  if (typeof bumpMetric === 'function') bumpMetric('queryMisses', 1);

  const languageEntry = treeSitterState.languageCache.get(languageId);
  const language = languageEntry?.language || null;
  if (!language || typeof language.query !== 'function') {
    cache?.set?.(languageId, null);
    return null;
  }

  const pattern = buildChunkQueryPattern(language, config);
  if (!pattern) {
    cache?.set?.(languageId, null);
    return null;
  }

  try {
    const query = language.query(pattern);
    cache?.set?.(languageId, query);
    if (typeof bumpMetric === 'function') bumpMetric('queryBuilds', 1);
    return query;
  } catch (err) {
    cache?.set?.(languageId, null);
    if (typeof bumpMetric === 'function') bumpMetric('queryFailures', 1);
    if (options?.log && !treeSitterState.loggedQueryFailures?.has?.(languageId)) {
      options.log(`[tree-sitter] Query compile failed for ${languageId}: ${err?.message || err}.`);
      treeSitterState.loggedQueryFailures?.add?.(languageId);
    }
    return null;
  }
};

/**
 * Resolve canonical parser language id from extension and optional hint.
 *
 * The primary extension map intentionally takes precedence over `languageId`
 * for well-known JS/TS aliases (`.tsx`, `.mjs`, etc.) to preserve existing
 * parser selection behavior.
 *
 * @param {string|null} languageId
 * @param {string|null} ext
 * @returns {string|null}
 */
export const resolveLanguageForExt = (languageId, ext) => {
  const normalizedExt = typeof ext === 'string' ? ext.toLowerCase() : '';
  const primary = PRIMARY_EXTENSION_LANGUAGE_MAP.get(normalizedExt);
  if (primary) return primary;
  if (languageId) return languageId;
  if (!normalizedExt) return null;
  return SECONDARY_EXTENSION_LANGUAGE_MAP.get(normalizedExt) || null;
};
