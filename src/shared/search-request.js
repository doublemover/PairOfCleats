export const SEARCH_FILTER_OPTION_NAMES = Object.freeze([
  'filter', 'type', 'author', 'import', 'lang', 'ext', 'path', 'file',
  'branches', 'loops', 'breaks', 'continues', 'churn', 'meta', 'meta-json',
  'calls', 'uses', 'signature', 'param', 'decorator', 'inferred-type', 'return-type',
  'throws', 'reads', 'writes', 'mutates', 'alias', 'lint', 'awaits', 'visibility',
  'extends', 'async', 'generator', 'returns', 'chunk-author', 'modified-after',
  'modified-since', 'risk', 'risk-tag', 'risk-source', 'risk-sink', 'risk-category',
  'risk-flow', 'struct-pack', 'struct-rule', 'struct-tag'
]);

export const hasSearchFilterArgs = (argv) => SEARCH_FILTER_OPTION_NAMES.some((key) => {
  const value = argv?.[key];
  const values = Array.isArray(value) ? value : [value];
  return values.some((entry) => entry === true || (typeof entry === 'string' && entry.trim().length > 0)
    || (typeof entry === 'number' && Number.isFinite(entry)));
});

export const STRING_FLAG_FIELDS = Object.freeze([
  ['type', '--type'],
  ['author', '--author'],
  ['import', '--import'],
  ['calls', '--calls'],
  ['uses', '--uses'],
  ['signature', '--signature'],
  ['param', '--param'],
  ['decorator', '--decorator'],
  ['inferredType', '--inferred-type'],
  ['returnType', '--return-type'],
  ['throws', '--throws'],
  ['reads', '--reads'],
  ['writes', '--writes'],
  ['mutates', '--mutates'],
  ['alias', '--alias'],
  ['awaits', '--awaits'],
  ['risk', '--risk'],
  ['riskTag', '--risk-tag'],
  ['riskSource', '--risk-source'],
  ['riskSink', '--risk-sink'],
  ['riskCategory', '--risk-category'],
  ['riskFlow', '--risk-flow'],
  ['chunkAuthor', '--chunk-author'],
  ['modifiedAfter', '--modified-after'],
  ['visibility', '--visibility'],
  ['extends', '--extends'],
  ['lang', '--lang'],
  ['branch', '--branch'],
  ['filter', '--filter']
]);

export const INTEGER_MIN_ZERO_FLAG_FIELDS = Object.freeze([
  ['branchesMin', '--branches'],
  ['loopsMin', '--loops'],
  ['breaksMin', '--breaks'],
  ['continuesMin', '--continues'],
  ['churnMin', '--churn'],
  ['modifiedSince', '--modified-since']
]);

export const REPEATED_LIST_FIELDS = Object.freeze([
  ['file', '--file'],
  ['ext', '--ext']
]);

const nonemptyString = { type: 'string', pattern: '\\S' };
const effectiveValue = { anyOf: [nonemptyString,
  { type: 'array', minItems: 1, items: nonemptyString }, { type: 'object', minProperties: 1 }] };
const requirement = (field, schema) => ({ required: [field], properties: { [field]: schema } });
/** Shared schema admission; exact predicate validation remains in the CLI owner. */
export const SEARCH_REQUEST_REQUIREMENT = Object.freeze({ anyOf: [
  requirement('query', nonemptyString),
  ...STRING_FLAG_FIELDS.filter(([field]) => field !== 'branch').map(([field]) => requirement(field, nonemptyString)),
  ...INTEGER_MIN_ZERO_FLAG_FIELDS.map(([field]) => requirement(field, { type: 'integer', minimum: 0 })),
  ...['lint', 'async', 'generator', 'returns'].map(field => requirement(field, { const: true })),
  ...['path', 'paths', 'file', 'ext', 'meta', 'metaJson'].map(field => requirement(field, effectiveValue))
] });

export const validateLegacySearchContext = payload => (
  Object.hasOwn(payload, 'context') && payload.context !== undefined && payload.context !== 0
    ? { ok: false, message: 'Search context lines are removed. Use source excerpts or context_pack; context:0 is a deprecated no-op.' }
    : { ok: true }
);

const normalizeOutput = (value, defaultOutput, allowedOutputs) => {
  const allowed = new Set(
    (Array.isArray(allowedOutputs) ? allowedOutputs : [])
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const fallback = String(defaultOutput || 'compact').trim().toLowerCase() || 'compact';
  const normalized = value == null || value === ''
    ? fallback
    : String(value).trim().toLowerCase();
  if (!allowed.size || allowed.has(normalized)) {
    return { ok: true, output: normalized };
  }
  return { ok: false, message: `Unsupported output mode: ${normalized}` };
};

const normalizeOptionalNumber = (value, { min = null } = {}) => {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  if (min == null) return numeric;
  return numeric < min ? min : numeric;
};

const toStringValue = (value) => {
  if (value == null || value === '') return null;
  return String(value);
};

const appendOptionalFlag = (args, flag, value) => {
  const normalized = toStringValue(value);
  if (!normalized) return;
  args.push(flag, normalized);
};

const appendRepeatedFlag = (args, flag, values) => {
  for (const value of values) {
    if (value == null || value === '') continue;
    const normalized = String(value).trim();
    if (!normalized) continue;
    args.push(flag, normalized);
  }
};

export const toList = (value) => (
  Array.isArray(value)
    ? value
    : (value == null || value === '' ? [] : [value])
);

export function normalizeMetaFilters(meta) {
  if (!meta) return null;
  if (Array.isArray(meta)) {
    const entries = meta.flatMap((entry) => {
      if (entry == null) return [];
      if (typeof entry === 'string') return [entry];
      if (typeof entry === 'object') {
        return Object.entries(entry).map(([key, value]) => (
          value == null || value === '' ? String(key) : `${key}=${value}`
        ));
      }
      return [String(entry)];
    });
    return entries.length ? entries : null;
  }
  if (typeof meta === 'object') {
    const entries = Object.entries(meta).map(([key, value]) => (
      value == null || value === '' ? String(key) : `${key}=${value}`
    ));
    return entries.length ? entries : null;
  }
  return [String(meta)];
}

export const normalizeMetaJson = (value) => {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export function buildSearchRequestArgs(payload = {}, {
  defaultOutput = 'compact',
  allowedOutputs = ['compact', 'full', 'json'],
  includeRepo = false,
  repoPath = null,
  topFlag = '--top',
  topMin = null,
  omitModeBoth = false
} = {}) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: 'Invalid search payload.' };
  }

  const query = String(payload.query || '').trim();
  const contextResult = validateLegacySearchContext(payload);
  if (!contextResult.ok) return contextResult;
  if (query && payload.cursor) return { ok: false, message: 'cursor requires a filter-only search without query text.' };

  const outputResult = normalizeOutput(payload.output, defaultOutput, allowedOutputs);
  if (!outputResult.ok) return outputResult;

  const searchArgs = ['--json'];
  if (includeRepo) {
    const repo = toStringValue(repoPath || payload.repoPath);
    if (repo) {
      searchArgs.push('--repo', repo);
    }
  }

  const output = outputResult.output;
  if (output !== 'full' && output !== 'json') {
    searchArgs.push('--compact');
  }

  const mode = toStringValue(payload.mode);
  const asOf = toStringValue(payload.asOf);
  const snapshot = toStringValue(payload.snapshot);
  const snapshotId = toStringValue(payload.snapshotId);
  if (asOf && (snapshot || snapshotId)) {
    return { ok: false, message: 'Cannot combine asOf with snapshot/snapshotId.' };
  }
  if (snapshot && snapshotId && snapshot !== snapshotId) {
    return { ok: false, message: 'snapshot and snapshotId conflict; provide only one reference.' };
  }
  const resolvedSnapshot = snapshot || snapshotId;
  const backend = toStringValue(payload.backend);
  const ann = typeof payload.ann === 'boolean' ? payload.ann : null;
  const allowSparseFallback = payload.allowSparseFallback === true;
  const allowUnsafeMix = payload.allowUnsafeMix === true;
  const top = normalizeOptionalNumber(payload.top, { min: topMin });

  if (asOf) {
    searchArgs.push('--as-of', asOf);
  } else if (resolvedSnapshot) {
    searchArgs.push('--snapshot', resolvedSnapshot);
  }
  if (mode && !(omitModeBoth && mode === 'both')) {
    searchArgs.push('--mode', mode);
  }
  if (backend) searchArgs.push('--backend', backend);
  if (ann === true) searchArgs.push('--ann');
  if (ann === false) searchArgs.push('--no-ann');
  if (allowSparseFallback) searchArgs.push('--allow-sparse-fallback');
  if (allowUnsafeMix) searchArgs.push('--allow-unsafe-mix');
  if (top != null) searchArgs.push(topFlag, String(top));
  appendOptionalFlag(searchArgs, '--cursor', payload.cursor);

  for (const [field, flag] of STRING_FLAG_FIELDS) {
    appendOptionalFlag(searchArgs, flag, payload[field]);
  }

  for (const [field, flag] of INTEGER_MIN_ZERO_FLAG_FIELDS) {
    const numeric = normalizeOptionalNumber(payload[field], { min: 0 });
    if (numeric != null) {
      searchArgs.push(flag, String(numeric));
    }
  }

  if (payload.lint === true) searchArgs.push('--lint');
  if (payload.async === true) searchArgs.push('--async');
  if (payload.generator === true) searchArgs.push('--generator');
  if (payload.returns === true) searchArgs.push('--returns');

  const caseAll = payload.case === true;
  const caseFile = payload.caseFile === true || caseAll;
  const caseTokens = payload.caseTokens === true || caseAll;
  if (caseAll) searchArgs.push('--case');
  if (!caseAll && caseFile) searchArgs.push('--case-file');
  if (!caseAll && caseTokens) searchArgs.push('--case-tokens');

  const pathFilters = [
    ...toList(payload.path),
    ...toList(payload.paths)
  ];
  appendRepeatedFlag(searchArgs, '--path', pathFilters);

  for (const [field, flag] of REPEATED_LIST_FIELDS) {
    appendRepeatedFlag(searchArgs, flag, toList(payload[field]));
  }

  const metaFilters = normalizeMetaFilters(payload.meta);
  if (Array.isArray(metaFilters)) {
    for (const entry of metaFilters) {
      appendOptionalFlag(searchArgs, '--meta', entry);
    }
  }

  appendOptionalFlag(searchArgs, '--meta-json', normalizeMetaJson(payload.metaJson));

  if (!query) {
    const flags = {};
    for (let i = 0; i < searchArgs.length; i += 1) {
      const flag = searchArgs[i];
      if (!flag.startsWith('--')) continue;
      const next = searchArgs[i + 1];
      flags[flag.slice(2)] = next && !next.startsWith('--') ? next : true;
    }
    if (!hasSearchFilterArgs(flags)) return { ok: false, message: 'Provide query text or at least one nonempty search filter.' };
  }

  return {
    ok: true,
    args: searchArgs,
    query,
    output
  };
}
