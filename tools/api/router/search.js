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

const parseInteger = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
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

export const buildSearchPayloadFromQuery = (searchParams) => {
  const payload = {};
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

  const top = parseInteger(searchParams.get('top'));
  if (top != null) payload.top = top;

  const context = parseInteger(searchParams.get('context'));
  if (context != null) payload.context = context;

  const ann = parseBoolean(searchParams.get('ann'));
  if (ann != null) payload.ann = ann;

  const booleanKeys = ['case', 'caseFile', 'caseTokens', 'lint', 'async', 'generator', 'returns'];
  for (const key of booleanKeys) {
    const parsed = parseBoolean(searchParams.get(key));
    if (parsed != null) payload[key] = parsed;
  }

  const integerKeys = ['branchesMin', 'loopsMin', 'breaksMin', 'continuesMin', 'churnMin', 'modifiedSince'];
  for (const key of integerKeys) {
    const parsed = parseInteger(searchParams.get(key));
    if (parsed != null) payload[key] = parsed;
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

  return payload;
};

export const isNoIndexError = (err) => {
  if (!err) return false;
  if (err.code === 'NO_INDEX') return true;
  if (err.code === 'ERR_INDEX_NOT_FOUND') return true;
  const message = String(err.message || '').toLowerCase();
  return message.includes('index not found') || message.includes('build index');
};
