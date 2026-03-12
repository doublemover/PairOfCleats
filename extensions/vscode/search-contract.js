function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function normalizeStringSetting(value) {
  return value == null ? '' : String(value).trim();
}

function readSearchOptions(config, settings) {
  return {
    mode: normalizeStringSetting(config.get(settings.modeKey)) || 'both',
    backend: normalizeStringSetting(config.get(settings.backendKey)),
    annEnabled: config.get(settings.annKey) !== false,
    maxResults: Number.isFinite(Number(config.get(settings.maxResultsKey)))
      ? Math.max(1, Number(config.get(settings.maxResultsKey)))
      : 25,
    contextLines: Number.isFinite(Number(config.get(settings.contextLinesKey)))
      ? Math.max(0, Number(config.get(settings.contextLinesKey)))
      : 0,
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
    modifiedSince: normalizeStringSetting(config.get(settings.modifiedSinceKey)),
    churn: normalizeStringSetting(config.get(settings.churnKey)),
    caseSensitive: config.get(settings.caseSensitiveKey) === true,
    extraArgs: normalizeStringArray(config.get(settings.extraSearchArgsKey))
  };
}

function buildSearchArgs(query, repoRoot, options = {}) {
  const args = ['search', '--json'];
  const maxResults = Number.isFinite(Number(options.maxResults))
    ? Math.max(1, Number(options.maxResults))
    : 25;
  args.push('--top', String(maxResults));

  const mode = normalizeStringSetting(options.mode) || 'both';
  const backend = normalizeStringSetting(options.backend);
  const file = normalizeStringSetting(options.file);
  const pathValue = normalizeStringSetting(options.path);
  const lang = normalizeStringSetting(options.lang);
  const ext = normalizeStringSetting(options.ext);
  const type = normalizeStringSetting(options.type);
  const asOf = normalizeStringSetting(options.asOf);
  const snapshot = normalizeStringSetting(options.snapshot);
  const filter = normalizeStringSetting(options.filter);
  const author = normalizeStringSetting(options.author);
  const modifiedAfter = normalizeStringSetting(options.modifiedAfter);
  const modifiedSince = normalizeStringSetting(options.modifiedSince);
  const churn = normalizeStringSetting(options.churn);
  const contextLines = Number.isFinite(Number(options.contextLines))
    ? Math.max(0, Number(options.contextLines))
    : 0;
  const extraArgs = normalizeStringArray(options.extraArgs);

  if (asOf && snapshot) {
    throw new Error('PairOfCleats VS Code search cannot set both searchAsOf and searchSnapshot.');
  }

  if (mode && mode !== 'both') args.push('--mode', mode);
  if (backend) args.push('--backend', backend);
  if (options.annEnabled === false) args.push('--no-ann');
  if (contextLines > 0) args.push('--context', String(contextLines));
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
  if (modifiedSince) args.push('--modified-since', modifiedSince);
  if (churn) args.push('--churn', churn);
  if (options.caseSensitive) args.push('--case');
  if (options.explain) args.push('--explain');
  if (repoRoot) args.push('--repo', repoRoot);
  args.push(...extraArgs);
  args.push('--', String(query ?? ''));
  return args;
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
  collectSearchHits
};
