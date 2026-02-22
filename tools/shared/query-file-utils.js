import fsPromises from 'node:fs/promises';

const JSON_MODE_STRINGIFY = 'stringify';
const JSON_MODE_QUERY_FIELD = 'query-field';

const parseTextQueries = (raw) => raw
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

const normalizeJsonEntries = (entries, jsonMode) => {
  if (!Array.isArray(entries)) return [];
  if (jsonMode === JSON_MODE_QUERY_FIELD) {
    return entries
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry.query === 'string') return entry.query;
        return null;
      })
      .filter(Boolean);
  }
  return entries.map((entry) => String(entry)).filter(Boolean);
};

const parseJsonQueries = (parsed, jsonMode) => {
  if (Array.isArray(parsed)) return normalizeJsonEntries(parsed, jsonMode);
  if (parsed && Array.isArray(parsed.queries)) {
    return normalizeJsonEntries(parsed.queries, jsonMode);
  }
  return [];
};

/**
 * Parse query file content.
 * @param {string} raw
 * @param {string} filePath
 * @param {{allowJson?:boolean,jsonMode?:'stringify'|'query-field'}} [options]
 * @returns {string[]}
 */
export function parseQueryFileContent(raw, filePath, options = {}) {
  const allowJson = options.allowJson !== false;
  const jsonMode = options.jsonMode === JSON_MODE_QUERY_FIELD
    ? JSON_MODE_QUERY_FIELD
    : JSON_MODE_STRINGIFY;
  if (allowJson && String(filePath || '').endsWith('.json')) {
    return parseJsonQueries(JSON.parse(raw), jsonMode);
  }
  return parseTextQueries(raw);
}

/**
 * Read and parse a query file.
 * @param {string} filePath
 * @param {{allowJson?:boolean,jsonMode?:'stringify'|'query-field'}} [options]
 * @returns {Promise<string[]>}
 */
export async function readQueryFile(filePath, options = {}) {
  const raw = await fsPromises.readFile(filePath, 'utf8');
  return parseQueryFileContent(raw, filePath, options);
}

/**
 * Read and parse a query file, returning an empty array on failure.
 * @param {string} filePath
 * @param {{allowJson?:boolean,jsonMode?:'stringify'|'query-field'}} [options]
 * @returns {Promise<string[]>}
 */
export async function readQueryFileSafe(filePath, options = {}) {
  try {
    return await readQueryFile(filePath, options);
  } catch {
    return [];
  }
}

/**
 * Parse a top-N argument using existing CLI defaults.
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function parseTopN(value, fallback = 5) {
  const parsed = parseInt(value, 10);
  return Math.max(1, parsed || fallback);
}

/**
 * Parse a limit argument using existing CLI defaults.
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function parseLimit(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Math.max(0, parsed || fallback);
}

/**
 * Parse top/limit options with defaults.
 * @param {{top?:unknown,limit?:unknown,defaultTop?:number,defaultLimit?:number}} [options]
 * @returns {{topN:number,limit:number}}
 */
export function resolveTopNAndLimit(options = {}) {
  return {
    topN: parseTopN(options.top, options.defaultTop ?? 5),
    limit: parseLimit(options.limit, options.defaultLimit ?? 0)
  };
}

/**
 * Apply a limit to a query list.
 * @param {string[]} queries
 * @param {number} limit
 * @returns {string[]}
 */
export function selectQueriesByLimit(queries, limit) {
  if (!Array.isArray(queries)) return [];
  return limit > 0 ? queries.slice(0, limit) : queries;
}
