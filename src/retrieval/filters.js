import { parseJson } from './query-cache.js';
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

const FILTER_TOKEN_RE = /"([^"]*)"|'([^']*)'|(\S+)/g;

const INTERNAL_FILTER_KEYS = new Set([
  'filePrefilter',
  'regexConfig',
  'caseFile',
  'caseTokens',
  'excludeTokens',
  'excludePhrases'
]);

const splitFilterTokens = (raw) => {
  const tokens = [];
  const input = String(raw || '').trim();
  if (!input) return tokens;
  let match = null;
  while ((match = FILTER_TOKEN_RE.exec(input))) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
};

const splitFilterValues = (value) => String(value || '')
  .split(',')
  .map((part) => part.trim())
  .filter(Boolean);

export function parseFilterExpression(raw) {
  const errors = [];
  const file = [];
  const lang = [];
  const ext = [];
  const type = [];
  const tokens = splitFilterTokens(raw);
  if (!tokens.length) {
    return {
      file: null,
      lang: null,
      ext: null,
      type: null,
      errors
    };
  }
  const pushValues = (list, value) => {
    for (const entry of splitFilterValues(value)) {
      list.push(entry);
    }
  };
  for (const token of tokens) {
    const trimmed = String(token || '').trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.search(/[:=]/);
    if (separatorIndex === -1) {
      pushValues(file, trimmed);
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim().toLowerCase();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!value) {
      errors.push(`missing value for ${key}`);
      continue;
    }
    if (key === 'path' || key === 'file') {
      pushValues(file, value);
    } else if (key === 'lang' || key === 'language') {
      pushValues(lang, value);
    } else if (key === 'ext' || key === 'extension') {
      pushValues(ext, value);
    } else if (key === 'type' || key === 'kind') {
      pushValues(type, value);
    } else {
      errors.push(`unknown filter key ${key}`);
    }
  }
  return {
    file: file.length ? file : null,
    lang: lang.length ? lang : null,
    ext: ext.length ? ext : null,
    type: type.length ? type : null,
    errors
  };
}

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
 * Normalize language filters into a list of language ids.
 * @param {string|string[]|null|undefined} langArg
 * @returns {string[]|null}
 */
export function normalizeLangFilter(langArg) {
  const entries = Array.isArray(langArg) ? langArg : (langArg ? [langArg] : []);
  if (!entries.length) return null;
  const langs = new Set();
  for (const entry of entries) {
    String(entry || '')
      .split(/[,\s]+/)
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
 * Merge extension filters with language filters.
 * @param {string[]|null} extFilter
 * @param {string[]|null} langFilter
 * @returns {string[]|null}
 */
const mergeFilterLists = (left, right) => {
  if (!left && !right) return null;
  const merged = new Set([...(left || []), ...(right || [])]);
  return merged.size ? Array.from(merged) : null;
};

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
