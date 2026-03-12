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
  const contextLines = Number.isFinite(Number(options.contextLines))
    ? Math.max(0, Number(options.contextLines))
    : 0;
  const extraArgs = normalizeStringArray(options.extraArgs);

  if (mode && mode !== 'both') args.push('--mode', mode);
  if (backend) args.push('--backend', backend);
  if (options.annEnabled === false) args.push('--no-ann');
  if (contextLines > 0) args.push('--context', String(contextLines));
  if (file) args.push('--file', file);
  if (pathValue) args.push('--path', pathValue);
  if (lang) args.push('--lang', lang);
  if (ext) args.push('--ext', ext);
  if (type) args.push('--type', type);
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
