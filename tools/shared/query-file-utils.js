import fsPromises from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { BENCH_QUERY_WORKLOAD_VERSION } from '../../src/contracts/benchmark-query-workload.js';

export const QUERY_INPUT_PLAN_VERSION = 2;
const JSON_MODE_QUERY_FIELD = 'query-field';
const digest = (domain, value) => createHash('sha256').update(`${domain}\0`).update(value).digest('hex');
const invalid = (message, filePath, index = null, cause = undefined) => Object.assign(
  new Error(`Query input ${filePath}${index == null ? '' : ` entry ${index + 1}`}: ${message}`, { cause }),
  { code: 'ERR_QUERY_INPUT', filePath, entryIndex: index });

const parseTextQueries = (raw) => raw
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

const normalizeJsonEntries = (entries, jsonMode, filePath) => {
  if (!Array.isArray(entries)) throw invalid('expected a query array.', filePath);
  return entries.map((entry, index) => {
    const query = typeof entry === 'string' ? entry : jsonMode === JSON_MODE_QUERY_FIELD
      && entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.query : undefined;
    if (typeof query !== 'string' || !query.trim()) throw invalid(
      jsonMode === JSON_MODE_QUERY_FIELD ? 'expected a nonblank string or query-field record.' : 'expected a nonblank string; records are not supported by this consumer.', filePath, index);
    return query.trim();
  });
};

const parseJsonQueries = (parsed, jsonMode, filePath) => {
  if (Array.isArray(parsed)) return { queries: normalizeJsonEntries(parsed, jsonMode, filePath), producer: null };
  if (parsed?.kind === 'bench-query-workload' && parsed.schemaVersion === BENCH_QUERY_WORKLOAD_VERSION) {
    const fields = ['schemaVersion', 'kind', 'querySemantics', 'generation', 'generatedAt', 'seed', 'indexDir',
      'mode', 'count', 'languageFamily', 'intentWeights', 'intentCounts', 'variantCounts', 'querySet', 'queries'];
    const generation = parsed.generation;
    if (Object.keys(parsed).some(key => !fields.includes(key)) || !Array.isArray(parsed.queries)
      || !Array.isArray(parsed.querySet) || parsed.count !== parsed.queries.length
      || parsed.querySet.length !== parsed.queries.length || parsed.querySet.some((row, index) => row?.query !== parsed.queries[index])
      || generation?.schemaVersion !== BENCH_QUERY_WORKLOAD_VERSION || !Number.isSafeInteger(generation.requestedCount) || generation.requestedCount < 0
      || generation.emittedCount !== parsed.count || generation.complete !== (generation.requestedCount === generation.emittedCount)) {
      throw invalid('inconsistent declared benchmark query workload.', filePath);
    }
    return { queries: normalizeJsonEntries(parsed.queries, 'strings', filePath),
      producer: Object.freeze({ kind: parsed.kind, schemaVersion: parsed.schemaVersion, qualification: 'producer-declared',
        requestedCount: generation.requestedCount, emittedCount: generation.emittedCount, complete: generation.complete }) };
  }
  if (parsed && typeof parsed === 'object' && Object.keys(parsed).length === 1 && Array.isArray(parsed.queries)) {
    return { queries: normalizeJsonEntries(parsed.queries, jsonMode, filePath), producer: null };
  }
  throw invalid('expected an array or an object containing only a queries array.', filePath);
};

/**
 * Parse query file content.
 * @param {string} raw
 * @param {string} filePath
 * @param {{allowJson?:boolean,jsonMode?:'strings'|'stringify'|'query-field'}} [options]
 * @returns {string[]}
 */
const parseQueryContent = (raw, filePath, options = {}) => {
  const allowJson = options.allowJson !== false;
  const jsonMode = options.jsonMode === JSON_MODE_QUERY_FIELD ? JSON_MODE_QUERY_FIELD : 'strings';
  let queries, producer = null;
  if (String(filePath || '').toLowerCase().endsWith('.json')) {
    if (!allowJson) throw invalid('JSON input is not supported by this text-only consumer.', filePath);
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (cause) { throw invalid('malformed JSON.', filePath, null, cause); }
    ({ queries, producer } = parseJsonQueries(parsed, jsonMode, filePath));
  } else queries = parseTextQueries(raw);
  if (!queries.length) throw invalid('no queries were supplied.', filePath);
  return { queries, producer };
};
export function parseQueryFileContent(raw, filePath, options = {}) {
  return parseQueryContent(raw, filePath, options).queries;
}

/** Capture the actual ordered workload once. Paths are human provenance;
 * content, selection/normalization policy, limit and case order own identity. */
export async function readQueryInputPlan(filePath, { limit = 0, explicit = true, fallback = null,
  allowJson = true, jsonMode = 'strings', readFile = fsPromises.readFile } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw invalid('limit must be a nonnegative safe integer.', filePath);
  let bytes, selection = explicit ? 'explicit-file' : 'default-file';
  try { bytes = await readFile(filePath); }
  catch (error) {
    const observation = observeStorageResource(error, { phase: 'query-input-acquisition' });
    observation.requireSettled();
    let code;
    try { code = error?.code; }
    catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
    observation.requireSettled();
    if (explicit || code !== 'ENOENT' || !fallback) throw invalid('file could not be read.', filePath, null, error);
    const selectedFallback = normalizeJsonEntries(fallback, 'strings', filePath);
    if (!selectedFallback.length) throw invalid('the named fallback is empty.', filePath);
    bytes = Buffer.from(JSON.stringify(selectedFallback)); selection = 'missing-default-fallback';
  }
  const contentHash = `sha256:${digest('query-input-bytes-v1', bytes)}`;
  let raw;
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (cause) { throw invalid('input must be valid UTF-8.', filePath, null, cause); }
  const format = selection === 'missing-default-fallback' ? 'json' : String(filePath).toLowerCase().endsWith('.json') ? 'json' : 'text';
  const { queries, producer } = selection === 'missing-default-fallback'
    ? { queries: normalizeJsonEntries(JSON.parse(raw), 'strings', filePath), producer: null }
    : parseQueryContent(raw, filePath, { allowJson, jsonMode });
  const normalization = Object.freeze({ encoding: 'utf8-fatal-bom-strip', text: 'trim-lines-ignore-blank-comments',
    container: 'array-queries-or-declared-bench-query-workload-v2',
    json: jsonMode === JSON_MODE_QUERY_FIELD ? 'query-field-text-projection-trim-reject-invalid' : 'strings-trim-reject-invalid' });
  const cases = Object.freeze(selectQueriesByLimit(queries, limit).map((query, index) => Object.freeze({
    caseId: `qc1:${digest('query-occurrence-v1', JSON.stringify([contentHash, index, query]))}`, index, query, weight: 1
  })));
  const identity = { schemaVersion: QUERY_INPUT_PLAN_VERSION, contentHash, selection, format, normalization, limit,
    availableCount: queries.length, cases };
  return Object.freeze({ schemaVersion: QUERY_INPUT_PLAN_VERSION, kind: 'admitted-query-input',
    key: `qp2:${digest('query-input-plan-v2', JSON.stringify(identity))}`,
    source: Object.freeze({ path: filePath, selection, format, contentHash,
      effectiveSource: selection === 'missing-default-fallback' ? 'inline-smoke-fallback' : 'file', producer }),
    normalization, limit, availableCount: queries.length, selectedCount: cases.length, cases });
}

/**
 * Read and parse a query file.
 * @param {string} filePath
 * @param {{allowJson?:boolean,jsonMode?:'stringify'|'query-field'}} [options]
 * @returns {Promise<string[]>}
 */
export async function readQueryFile(filePath, options = {}) {
  return (await readQueryInputPlan(filePath, options)).cases.map(entry => entry.query);
}

/**
 * Legacy optional-input projection. Only an absent file returns an empty list;
 * malformed/unreadable inputs remain errors. Required consumers use the plan.
 * @param {string} filePath
 * @param {{allowJson?:boolean,jsonMode?:'stringify'|'query-field'}} [options]
 * @returns {Promise<string[]>}
 */
export async function readQueryFileSafe(filePath, options = {}) {
  try {
    return await readQueryFile(filePath, options);
  } catch (error) {
    const observation = observeStorageResource(error, { phase: 'optional-query-input' });
    observation.requireSettled();
    try { if (error?.code === 'ERR_QUERY_INPUT' && error.cause?.code === 'ENOENT') return []; }
    catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
    throw error;
  }
}

/**
 * Parse a top-N argument using existing CLI defaults.
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function parseTopN(value, fallback = 5) {
  const parsed = parseInt(value, 10);
  return Math.max(1, parsed || fallback);
}

/**
 * Parse a limit argument using existing CLI defaults.
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function parseLimit(value, fallback = 0) {
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
