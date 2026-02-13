import { buildSearchRequestArgs } from '../../shared/search-request.js';

export const buildSearchParams = (_repoPath, payload, defaultOutput) => {
  const result = buildSearchRequestArgs(payload, {
    defaultOutput,
    allowedOutputs: ['compact', 'json', 'full'],
    includeRepo: false,
    topFlag: '--top',
    topMin: 0,
    omitModeBoth: false
  });
  if (!result.ok) {
    return { ok: false, message: result.message || 'Invalid search payload.' };
  }
  return {
    ok: true,
    args: result.args,
    query: result.query
  };
};

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return null;
};
/**
 * Parse a boolean query parameter strictly while distinguishing absent values
 * from malformed values.
 *
 * This is used by GET /search so invalid booleans return 400 instead of being
 * silently dropped before schema validation.
 *
 * @param {URLSearchParams} searchParams
 * @param {string} key
 * @returns {{ok:boolean,present:boolean,value:boolean|null,key:string,message?:string}}
 */
const parseStrictBooleanQueryParam = (searchParams, key) => {
  if (!searchParams.has(key)) {
    return { ok: true, present: false, value: null, key };
  }
  const parsed = parseBoolean(searchParams.get(key));
  if (parsed == null) {
    return {
      ok: false,
      present: true,
      value: null,
      key,
      message: `${key} must be a boolean.`
    };
  }
  return { ok: true, present: true, value: parsed, key };
};

/**
 * Parse an integer query parameter strictly while distinguishing absent values
 * from malformed values.
 *
 * @param {URLSearchParams} searchParams
 * @param {string} key
 * @returns {{ok:boolean,present:boolean,value:number|null,key:string,message?:string}}
 */
const parseStrictIntegerQueryParam = (searchParams, key) => {
  if (!searchParams.has(key)) {
    return { ok: true, present: false, value: null, key };
  }
  const raw = searchParams.get(key);
  const normalized = String(raw ?? '').trim();
  if (!normalized || !/^-?\d+$/.test(normalized)) {
    return {
      ok: false,
      present: true,
      value: null,
      key,
      message: `${key} must be an integer.`
    };
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    return {
      ok: false,
      present: true,
      value: null,
      key,
      message: `${key} must be a safe integer.`
    };
  }
  return { ok: true, present: true, value: parsed, key };
};

const getString = (searchParams, ...keys) => {
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
};

const getStringList = (searchParams, ...keys) => {
  const values = [];
  for (const key of keys) {
    const raw = searchParams.getAll(key);
    for (const entry of raw) {
      if (entry == null) continue;
      const text = String(entry).trim();
      if (text) values.push(text);
    }
  }
  if (!values.length) return null;
  return values.length === 1 ? values[0] : values;
};

/**
 * Build a search payload from URL query params and collect parse-time errors.
 *
 * @param {URLSearchParams} searchParams
 * @returns {{payload: Record<string, any>, errors: Array<{path:string,message:string}>}}
 */
export const buildSearchPayloadFromQuery = (searchParams) => {
  const payload = {};
  const errors = [];
  const query = getString(searchParams, 'q', 'query');
  if (query) payload.query = query;

  const repo = getString(searchParams, 'repo', 'repoPath');
  if (repo) payload.repo = repo;

  const asOf = getString(searchParams, 'asOf', 'as-of');
  if (asOf) payload.asOf = asOf;

  const snapshotId = getString(searchParams, 'snapshotId', 'snapshot');
  if (snapshotId) payload.snapshotId = snapshotId;

  const output = getString(searchParams, 'output');
  if (output) payload.output = output;

  const mode = getString(searchParams, 'mode');
  if (mode) payload.mode = mode;

  const backend = getString(searchParams, 'backend');
  if (backend) payload.backend = backend;

  const top = parseStrictIntegerQueryParam(searchParams, 'top');
  if (!top.ok) errors.push({ path: 'top', message: top.message });
  else if (top.present) payload.top = top.value;

  const context = parseStrictIntegerQueryParam(searchParams, 'context');
  if (!context.ok) errors.push({ path: 'context', message: context.message });
  else if (context.present) payload.context = context.value;

  const ann = parseStrictBooleanQueryParam(searchParams, 'ann');
  if (!ann.ok) errors.push({ path: 'ann', message: ann.message });
  else if (ann.present) payload.ann = ann.value;

  const booleanKeys = ['case', 'caseFile', 'caseTokens', 'lint', 'async', 'generator', 'returns'];
  for (const key of booleanKeys) {
    const parsed = parseStrictBooleanQueryParam(searchParams, key);
    if (!parsed.ok) errors.push({ path: key, message: parsed.message });
    else if (parsed.present) payload[key] = parsed.value;
  }

  const integerKeys = ['branchesMin', 'loopsMin', 'breaksMin', 'continuesMin', 'churnMin', 'modifiedSince'];
  for (const key of integerKeys) {
    const parsed = parseStrictIntegerQueryParam(searchParams, key);
    if (!parsed.ok) errors.push({ path: key, message: parsed.message });
    else if (parsed.present) payload[key] = parsed.value;
  }

  const stringKeys = [
    'type',
    'author',
    'import',
    'calls',
    'uses',
    'signature',
    'param',
    'decorator',
    'inferredType',
    'returnType',
    'throws',
    'reads',
    'writes',
    'mutates',
    'alias',
    'awaits',
    'risk',
    'riskTag',
    'riskSource',
    'riskSink',
    'riskCategory',
    'riskFlow',
    'chunkAuthor',
    'modifiedAfter',
    'visibility',
    'extends',
    'lang',
    'branch',
    'filter'
  ];
  for (const key of stringKeys) {
    const value = getString(searchParams, key);
    if (value) payload[key] = value;
  }

  const pathList = getStringList(searchParams, 'path', 'paths');
  if (pathList != null) payload.path = pathList;
  const fileList = getStringList(searchParams, 'file');
  if (fileList != null) payload.file = fileList;
  const extList = getStringList(searchParams, 'ext');
  if (extList != null) payload.ext = extList;

  return { payload, errors };
};

export const isNoIndexError = (err) => {
  if (!err) return false;
  if (err.code === 'NO_INDEX') return true;
  if (err.code === 'ERR_INDEX_NOT_FOUND') return true;
  const message = String(err.message || '').toLowerCase();
  return message.includes('index not found') || message.includes('build index');
};
