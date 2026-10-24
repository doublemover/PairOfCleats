function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function normalizeStringSetting(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeNonnegativeIntegerSetting(value, label) {
  if (value == null || value === '') return null;
  const text = typeof value === 'string' ? value.trim() : value;
  if (text === '') return null;
  if ((typeof text !== 'number' && (typeof text !== 'string' || !/^\d+$/.test(text)))
    || !Number.isSafeInteger(Number(text)) || Number(text) < 0) {
    throw new Error(`PairOfCleats ${label} must be a nonnegative safe integer or empty.`);
  }
  return Number(text);
}

function normalizeLegacyContext(value) {
  if (value === undefined || value === 0) return 0;
  throw new Error('PairOfCleats searchContextLines is removed. Set it to 0 or use source excerpts/context packs.');
}

function readSearchOptions(config, settings) {
  return {
    mode: normalizeStringSetting(config.get(settings.modeKey)) || 'both',
    backend: normalizeStringSetting(config.get(settings.backendKey)),
    annEnabled: config.get(settings.annKey) !== false,
    maxResults: Number.isFinite(Number(config.get(settings.maxResultsKey)))
      ? Math.max(1, Number(config.get(settings.maxResultsKey)))
      : 25,
    contextLines: normalizeLegacyContext(config.get('searchContextLines')),
    file: normalizeStringSetting(config.get(settings.fileKey)),
    path: normalizeStringSetting(config.get(settings.pathKey)),
    lang: normalizeStringSetting(config.get(settings.langKey)),
    ext: normalizeStringSetting(config.get(settings.extKey)),
    type: normalizeStringSetting(config.get(settings.typeKey)),
    asOf: normalizeStringSetting(config.get(settings.asOfKey)),
    snapshot: normalizeStringSetting(config.get(settings.snapshotKey)),
    filter: normalizeStringSetting(config.get(settings.filterKey)),
    author: normalizeStringSetting(config.get(settings.authorKey)),
    modifiedAfter: normalizeStringSetting(config.get(settings.modifiedAfterKey)),
    modifiedSince: normalizeNonnegativeIntegerSetting(config.get(settings.modifiedSinceKey), 'searchModifiedSince'),
    churn: normalizeStringSetting(config.get(settings.churnKey)),
    caseSensitive: config.get(settings.caseSensitiveKey) === true,
    extraArgs: normalizeStringArray(config.get(settings.extraSearchArgsKey))
  };
}

function normalizeSearchContractOptions(options = {}) {
  const contract = require('./editor-config-contract.json').search || {};
  const modes = contract.modes || ['code', 'prose', 'both', 'records', 'extracted-prose', 'all'];
  const backends = contract.backends || ['auto', 'memory', 'sqlite', 'sqlite-fts', 'lmdb', 'tantivy'];
  if (options.mode && !modes.includes(options.mode)) throw new Error(`Unsupported search mode: ${options.mode}. Choose ${modes.join(', ')}.`);
  if (options.backend && !backends.includes(options.backend)) throw new Error(`Unsupported search backend: ${options.backend}. Choose ${backends.join(', ')}.`);
  return {
    mode: normalizeStringSetting(options.mode) || 'both',
    backend: normalizeStringSetting(options.backend),
    file: normalizeStringSetting(options.file),
    pathValue: normalizeStringSetting(options.path),
    lang: normalizeStringSetting(options.lang),
    ext: normalizeStringSetting(options.ext),
    type: normalizeStringSetting(options.type),
    asOf: normalizeStringSetting(options.asOf),
    snapshot: normalizeStringSetting(options.snapshot),
    filter: normalizeStringSetting(options.filter),
    author: normalizeStringSetting(options.author),
    modifiedAfter: normalizeStringSetting(options.modifiedAfter),
    modifiedSince: normalizeNonnegativeIntegerSetting(options.modifiedSince, 'searchModifiedSince'),
    churn: normalizeStringSetting(options.churn),
    contextLines: normalizeLegacyContext(options.contextLines)
  };
}

function buildSearchArgs(query, repoRoot, options = {}) {
  const args = ['search', '--json'];
  const maxResults = Number.isFinite(Number(options.maxResults))
    ? Math.max(1, Number(options.maxResults))
    : 25;
  args.push('--top', String(maxResults));

  const {
    mode,
    backend,
    file,
    pathValue,
    lang,
    ext,
    type,
    asOf,
    snapshot,
    filter,
    author,
    modifiedAfter,
    modifiedSince,
    churn,
    contextLines
  } = normalizeSearchContractOptions(options);
  const extraArgs = normalizeStringArray(options.extraArgs);

  if (asOf && snapshot) {
    throw new Error('PairOfCleats VS Code search cannot set both searchAsOf and searchSnapshot.');
  }

  if (mode && mode !== 'both') args.push('--mode', mode);
  if (backend) args.push('--backend', backend);
  if (options.annEnabled === false) args.push('--no-ann');
  if (options.cursor) args.push('--cursor', String(options.cursor));
  if (file) args.push('--file', file);
  if (pathValue) args.push('--path', pathValue);
  if (lang) args.push('--lang', lang);
  if (ext) args.push('--ext', ext);
  if (type) args.push('--type', type);
  if (asOf) args.push('--as-of', asOf);
  else if (snapshot) args.push('--snapshot', snapshot);
  if (filter) args.push('--filter', filter);
  if (author) args.push('--author', author);
  if (modifiedAfter) args.push('--modified-after', modifiedAfter);
  if (modifiedSince !== null) args.push('--modified-since', String(modifiedSince));
  if (churn) args.push('--churn', churn);
  if (options.caseSensitive) args.push('--case');
  if (options.explain) args.push('--explain');
  if (repoRoot) args.push('--repo', repoRoot);
  args.push(...extraArgs);
  args.push('--', String(query ?? ''));
  return args;
}

function buildSearchPayload(query, repoRoot, options = {}) {
  const apiBackends = require('./editor-config-contract.json').search?.apiBackends
    || ['auto', 'memory', 'sqlite', 'sqlite-fts', 'lmdb'];
  if (options.backend && !apiBackends.includes(options.backend)) {
    throw new Error(`The API does not admit backend ${options.backend}. Select a supported API backend or deliberately choose CLI mode.`);
  }
  const {
    mode,
    backend,
    file,
    pathValue,
    lang,
    ext,
    type,
    asOf,
    snapshot,
    filter,
    author,
    modifiedAfter,
    modifiedSince,
    churn,
    contextLines
  } = normalizeSearchContractOptions(options);
  const payload = {
    query: String(query ?? ''),
    repo: repoRoot || '',
    top: Number.isFinite(Number(options.maxResults))
      ? Math.max(1, Number(options.maxResults))
      : 25,
    mode
  };

  if (asOf && snapshot) {
    throw new Error('PairOfCleats VS Code search cannot set both searchAsOf and searchSnapshot.');
  }

  if (backend) payload.backend = backend;
  if (options.annEnabled === false) payload.ann = false;
  if (options.cursor) payload.cursor = String(options.cursor);
  if (file) payload.file = file;
  if (pathValue) payload.path = pathValue;
  if (lang) payload.lang = lang;
  if (ext) payload.ext = ext;
  if (type) payload.type = type;
  if (asOf) payload.asOf = asOf;
  else if (snapshot) payload.snapshotId = snapshot;
  if (filter) payload.filter = filter;
  if (author) payload.author = author;
  if (modifiedAfter) payload.modifiedAfter = modifiedAfter;
  if (modifiedSince !== null) payload.modifiedSince = modifiedSince;
  if (churn) payload.churnMin = Number.isFinite(Number(churn)) ? Math.max(0, Number(churn)) : churn;
  if (options.caseSensitive) payload.case = true;
  return payload;
}

function collectSearchHits(payload) {
  const hits = [];
  const pushHits = (items, section) => {
    if (!Array.isArray(items)) return;
    items.forEach((hit) => {
      if (!hit || !hit.file) return;
      hits.push({
        ...hit,
        section
      });
    });
  };

  pushHits(payload?.code, 'code');
  pushHits(payload?.prose, 'prose');
  pushHits(payload?.extractedProse, 'extracted-prose');
  pushHits(payload?.records, 'records');
  return hits;
}

module.exports = {
  readSearchOptions,
  buildSearchArgs,
  buildSearchPayload,
  collectSearchHits
};
