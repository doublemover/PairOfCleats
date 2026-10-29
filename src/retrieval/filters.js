import { mergeFilterLists } from '../shared/filter/merge.js';
const LANG_ALIAS_MAP = new Map([
  ['javascript', 'javascript'],
  ['js', 'javascript'],
  ['node', 'javascript'],
  ['typescript', 'typescript'],
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['python', 'python'],
  ['py', 'python'],
  ['swift', 'swift'],
  ['rust', 'rust'],
  ['rs', 'rust'],
  ['go', 'go'],
  ['golang', 'go'],
  ['java', 'java'],
  ['kotlin', 'kotlin'],
  ['kt', 'kotlin'],
  ['csharp', 'csharp'],
  ['c#', 'csharp'],
  ['ruby', 'ruby'],
  ['rb', 'ruby'],
  ['php', 'php'],
  ['lua', 'lua'],
  ['sql', 'sql'],
  ['perl', 'perl'],
  ['shell', 'shell'],
  ['bash', 'shell'],
  ['zsh', 'shell'],
  ['clike', 'clike'],
  ['c', 'clike'],
  ['cpp', 'clike'],
  ['c++', 'clike'],
  ['objective-c', 'clike'],
  ['objc', 'clike'],
  ['objective-c++', 'clike'],
  ['html', 'html'],
  ['css', 'css'],
  ['dockerfile', 'dockerfile'],
  ['makefile', 'makefile'],
  ['cmake', 'cmake'],
  ['starlark', 'starlark'],
  ['bazel', 'starlark'],
  ['nix', 'nix'],
  ['dart', 'dart'],
  ['scala', 'scala'],
  ['groovy', 'groovy'],
  ['r', 'r'],
  ['julia', 'julia'],
  ['handlebars', 'handlebars'],
  ['mustache', 'mustache'],
  ['jinja', 'jinja'],
  ['jinja2', 'jinja'],
  ['django', 'jinja'],
  ['razor', 'razor'],
  ['protobuf', 'protobuf'],
  ['protocol buffer', 'protobuf'],
  ['protocol buffers', 'protobuf'],
  ['graphql', 'graphql']
]);


const INTERNAL_FILTER_KEYS = new Set([
  'filePrefilter',
  'regexConfig',
  'caseFile',
  'caseTokens',
  'excludeTokens',
  'excludePhrases'
]);

export { parseFilterExpression, serializeFilterExpression } from './filter-expression.js';

/**
 * Normalize extension filters into a lowercase list.
 * @param {string|string[]|null|undefined} extArg
 * @returns {string[]|null}
 */
export function normalizeExtFilter(extArg, { preserveValues = false } = {}) {
  const entries = Array.isArray(extArg) ? extArg : (extArg ? [extArg] : []);
  if (!entries.length) return null;
  const normalized = [];
  for (const entry of entries) {
    (preserveValues ? [String(entry ?? '')] : String(entry || '').split(/[,\s]+/))
      .map((raw) => raw.trim())
      .filter(Boolean)
      .forEach((raw) => {
        let value = raw.toLowerCase();
        value = value.replace(/^\*+/, '');
        if (!value) return;
        if (!value.startsWith('.')) value = `.${value}`;
        normalized.push(value);
      });
  }
  return normalized.length ? Array.from(new Set(normalized)) : null;
}

/**
 * Normalize language filters into a list of language ids.
 * @param {string|string[]|null|undefined} langArg
 * @returns {string[]|null}
 */
export function normalizeLangFilter(langArg, { preserveValues = false } = {}) {
  const entries = Array.isArray(langArg) ? langArg : (langArg ? [langArg] : []);
  if (!entries.length) return null;
  const langs = new Set();
  for (const entry of entries) {
    (preserveValues ? [String(entry ?? '')] : String(entry || '').split(/[,\s]+/))
      .map((raw) => raw.trim().toLowerCase())
      .filter(Boolean)
      .forEach((raw) => {
        const mapped = LANG_ALIAS_MAP.get(raw) || raw;
        if (mapped) langs.add(mapped);
      });
  }
  return langs.size ? Array.from(langs) : null;
}

/**
 * Merge filter lists so multiple sources intersect (CLI + --filter).
 * @param {string[]|null} left
 * @param {string[]|null} right
 * @returns {{values: string[]|null, impossible: boolean}}
 */
export function mergeExtFilters(extFilter, extraFilter) {
  return mergeFilterLists(extFilter, extraFilter);
}

/**
 * Merge language filters into a normalized list.
 * @param {string[]|null} langFilter
 * @param {string[]|null} extraFilter
 * @returns {string[]|null}
 */
export function mergeLangFilters(langFilter, extraFilter) {
  return mergeFilterLists(langFilter, extraFilter);
}

/**
 * Parse --meta and --meta-json into a normalized filter list.
 * @param {string|string[]|null|undefined} metaArg
 * @param {string|string[]|null|undefined} metaJsonArg
 * @returns {Array<{key:string,value:any}>|null}
 */
export function parseMetaFilters(metaArg, metaJsonArg) {
  const filters = [];
  const pushFilter = (rawKey, rawValue) => {
    const key = String(rawKey || '').trim();
    if (!key) return;
    const value = rawValue === undefined ? null : rawValue;
    filters.push({ key, value });
  };
  const handleEntry = (entry) => {
    const text = String(entry || '').trim();
    if (!text) return;
    const split = text.split('=');
    const key = split.shift();
    const value = split.length ? split.join('=').trim() : null;
    pushFilter(key, value === '' ? null : value);
  };
  const metaEntries = Array.isArray(metaArg) ? metaArg : (metaArg ? [metaArg] : []);
  for (const entry of metaEntries) handleEntry(entry);
  const metaJsonEntries = Array.isArray(metaJsonArg) ? metaJsonArg : (metaJsonArg != null ? [metaJsonArg] : []);
  for (const entry of metaJsonEntries) {
    let parsed;
    try { parsed = typeof entry === 'string' ? JSON.parse(entry) : entry; }
    catch (cause) { throw Object.assign(new Error('Invalid --meta-json: expected a JSON object.'), { code: 'INVALID_REQUEST', cause }); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw Object.assign(new Error('Invalid --meta-json: expected a JSON object.'), { code: 'INVALID_REQUEST' });
    }
    Object.entries(parsed).forEach(([key, value]) => pushFilter(key, value));
  }
  return filters.length ? filters : null;
}

/**
 * Check whether any search filters are active.
 * @param {object|null|undefined} filters
 * @returns {boolean}
 */
export function hasActiveFilters(filters) {
  if (!filters || typeof filters !== 'object') return false;
  for (const [key, value] of Object.entries(filters)) {
    if (INTERNAL_FILTER_KEYS.has(key)) continue;
    if (value == null) continue;
    if (typeof value === 'boolean') {
      if (value) return true;
      continue;
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) return true;
      continue;
    }
    if (typeof value === 'string') {
      if (value.trim()) return true;
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length) return true;
      continue;
    }
    if (typeof value === 'object') {
      if (Object.keys(value).length) return true;
      continue;
    }
    return true;
  }
  return false;
}
