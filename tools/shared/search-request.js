const STRING_FLAG_FIELDS = Object.freeze([
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

const INTEGER_MIN_ZERO_FLAG_FIELDS = Object.freeze([
  ['branchesMin', '--branches'],
  ['loopsMin', '--loops'],
  ['breaksMin', '--breaks'],
  ['continuesMin', '--continues'],
  ['churnMin', '--churn'],
  ['modifiedSince', '--modified-since']
]);

const REPEATED_LIST_FIELDS = Object.freeze([
  ['file', '--file'],
  ['ext', '--ext']
]);

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

/**
 * Normalize meta filters into CLI-friendly key/value strings.
 * @param {any} meta
 * @returns {string[]|null}
 */
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
  if (!query) {
    return { ok: false, message: 'Missing query.' };
  }

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
  // Historical selectors are mutually exclusive. Reject ambiguous requests
  // instead of silently preferring one reference over another.
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
  const top = normalizeOptionalNumber(payload.top, { min: topMin });
  const contextLines = normalizeOptionalNumber(payload.context, { min: 0 });

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
  if (top != null) searchArgs.push(topFlag, String(top));
  if (contextLines != null) searchArgs.push('--context', String(contextLines));

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

  return {
    ok: true,
    args: searchArgs,
    query,
    output
  };
}
