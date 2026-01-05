import { parseJson } from './query-cache.js';
import {
  CLIKE_EXTS,
  CSHARP_EXTS,
  CSS_EXTS,
  GO_EXTS,
  HTML_EXTS,
  JAVA_EXTS,
  JS_EXTS,
  KOTLIN_EXTS,
  LUA_EXTS,
  OBJC_EXTS,
  PERL_EXTS,
  PHP_EXTS,
  RUBY_EXTS,
  SHELL_EXTS,
  SQL_EXTS,
  TS_EXTS
} from '../index/constants.js';

const PY_EXTS = new Set(['.py']);
const SWIFT_EXTS = new Set(['.swift']);
const DOC_EXTS = new Set(['.md', '.rst', '.adoc', '.asciidoc']);
const CONFIG_EXTS = new Set(['.json', '.toml', '.ini', '.cfg', '.conf', '.xml', '.yml', '.yaml']);

const LANG_EXT_MAP = new Map([
  ['javascript', JS_EXTS],
  ['js', JS_EXTS],
  ['typescript', TS_EXTS],
  ['ts', TS_EXTS],
  ['python', PY_EXTS],
  ['py', PY_EXTS],
  ['swift', SWIFT_EXTS],
  ['rust', new Set(['.rs'])],
  ['go', GO_EXTS],
  ['java', JAVA_EXTS],
  ['csharp', CSHARP_EXTS],
  ['c#', CSHARP_EXTS],
  ['kotlin', KOTLIN_EXTS],
  ['ruby', RUBY_EXTS],
  ['php', PHP_EXTS],
  ['lua', LUA_EXTS],
  ['sql', SQL_EXTS],
  ['perl', PERL_EXTS],
  ['shell', SHELL_EXTS],
  ['bash', SHELL_EXTS],
  ['zsh', SHELL_EXTS],
  ['clike', CLIKE_EXTS],
  ['c', new Set(['.c', '.h'])],
  ['cpp', new Set(['.cc', '.cpp', '.hpp', '.hh'])],
  ['c++', new Set(['.cc', '.cpp', '.hpp', '.hh'])],
  ['objc', OBJC_EXTS],
  ['objective-c', OBJC_EXTS],
  ['html', HTML_EXTS],
  ['css', CSS_EXTS],
  ['json', new Set(['.json'])],
  ['yaml', new Set(['.yml', '.yaml'])],
  ['toml', new Set(['.toml'])],
  ['ini', new Set(['.ini', '.cfg', '.conf'])],
  ['xml', new Set(['.xml'])],
  ['markdown', new Set(['.md'])],
  ['rst', new Set(['.rst'])],
  ['asciidoc', new Set(['.adoc', '.asciidoc'])],
  ['docs', DOC_EXTS],
  ['config', CONFIG_EXTS]
]);

/**
 * Normalize extension filters into a lowercase list.
 * @param {string|string[]|null|undefined} extArg
 * @returns {string[]|null}
 */
export function normalizeExtFilter(extArg) {
  const entries = Array.isArray(extArg) ? extArg : (extArg ? [extArg] : []);
  if (!entries.length) return null;
  const normalized = [];
  for (const entry of entries) {
    String(entry || '')
      .split(/[,\s]+/)
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
 * Normalize language filters into a list of extensions.
 * @param {string|string[]|null|undefined} langArg
 * @returns {string[]|null}
 */
export function normalizeLangFilter(langArg) {
  const entries = Array.isArray(langArg) ? langArg : (langArg ? [langArg] : []);
  if (!entries.length) return null;
  const exts = new Set();
  for (const entry of entries) {
    String(entry || '')
      .split(/[,\s]+/)
      .map((raw) => raw.trim().toLowerCase())
      .filter(Boolean)
      .forEach((raw) => {
        const mapped = LANG_EXT_MAP.get(raw);
        if (!mapped) return;
        for (const ext of mapped) exts.add(ext);
      });
  }
  return exts.size ? Array.from(exts) : null;
}

/**
 * Merge extension filters with language filters.
 * @param {string[]|null} extFilter
 * @param {string[]|null} langFilter
 * @returns {string[]|null}
 */
export function mergeExtFilters(extFilter, langFilter) {
  if (!extFilter && !langFilter) return null;
  if (extFilter && langFilter) {
    const langSet = new Set(langFilter);
    const merged = extFilter.filter((ext) => langSet.has(ext));
    return merged.length ? Array.from(new Set(merged)) : null;
  }
  return extFilter || langFilter;
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
  const metaJsonEntries = Array.isArray(metaJsonArg) ? metaJsonArg : (metaJsonArg ? [metaJsonArg] : []);
  for (const entry of metaJsonEntries) {
    const parsed = parseJson(entry, null);
    if (!parsed) continue;
    if (Array.isArray(parsed)) {
      parsed.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        Object.entries(item).forEach(([key, value]) => pushFilter(key, value));
      });
    } else if (typeof parsed === 'object') {
      Object.entries(parsed).forEach(([key, value]) => pushFilter(key, value));
    }
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
  for (const value of Object.values(filters)) {
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
