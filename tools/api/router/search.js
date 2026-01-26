export const buildSearchParams = (repoPath, payload, defaultOutput) => {
  const query = payload?.query ? String(payload.query) : '';
  if (!query) {
    return { ok: false, message: 'Missing query.' };
  }
  const output = payload?.output || defaultOutput;
  const useCompact = output !== 'full' && output !== 'json';
  const searchArgs = ['--json', '--repo', repoPath];
  if (useCompact) searchArgs.push('--compact');
  const mode = payload?.mode ? String(payload.mode) : null;
  const backend = payload?.backend ? String(payload.backend) : null;
  const ann = payload?.ann;
  const top = Number.isFinite(Number(payload?.top)) ? Number(payload.top) : null;
  const context = Number.isFinite(Number(payload?.context)) ? Number(payload.context) : null;
  const typeFilter = payload?.type ? String(payload.type) : null;
  const authorFilter = payload?.author ? String(payload.author) : null;
  const importFilter = payload?.import ? String(payload.import) : null;
  const callsFilter = payload?.calls ? String(payload.calls) : null;
  const usesFilter = payload?.uses ? String(payload.uses) : null;
  const signatureFilter = payload?.signature ? String(payload.signature) : null;
  const paramFilter = payload?.param ? String(payload.param) : null;
  const decoratorFilter = payload?.decorator ? String(payload.decorator) : null;
  const inferredTypeFilter = payload?.inferredType ? String(payload.inferredType) : null;
  const returnTypeFilter = payload?.returnType ? String(payload.returnType) : null;
  const throwsFilter = payload?.throws ? String(payload.throws) : null;
  const readsFilter = payload?.reads ? String(payload.reads) : null;
  const writesFilter = payload?.writes ? String(payload.writes) : null;
  const mutatesFilter = payload?.mutates ? String(payload.mutates) : null;
  const aliasFilter = payload?.alias ? String(payload.alias) : null;
  const awaitsFilter = payload?.awaits ? String(payload.awaits) : null;
  const riskFilter = payload?.risk ? String(payload.risk) : null;
  const riskTagFilter = payload?.riskTag ? String(payload.riskTag) : null;
  const riskSourceFilter = payload?.riskSource ? String(payload.riskSource) : null;
  const riskSinkFilter = payload?.riskSink ? String(payload.riskSink) : null;
  const riskCategoryFilter = payload?.riskCategory ? String(payload.riskCategory) : null;
  const riskFlowFilter = payload?.riskFlow ? String(payload.riskFlow) : null;
  const branchesMin = Number.isFinite(Number(payload?.branchesMin)) ? Number(payload.branchesMin) : null;
  const loopsMin = Number.isFinite(Number(payload?.loopsMin)) ? Number(payload.loopsMin) : null;
  const breaksMin = Number.isFinite(Number(payload?.breaksMin)) ? Number(payload.breaksMin) : null;
  const continuesMin = Number.isFinite(Number(payload?.continuesMin)) ? Number(payload.continuesMin) : null;
  const churnMin = Number.isFinite(Number(payload?.churnMin)) ? Number(payload.churnMin) : null;
  const chunkAuthorFilter = payload?.chunkAuthor ? String(payload.chunkAuthor) : null;
  const modifiedAfter = payload?.modifiedAfter ? String(payload.modifiedAfter) : null;
  const modifiedSince = Number.isFinite(Number(payload?.modifiedSince)) ? Number(payload.modifiedSince) : null;
  const visibilityFilter = payload?.visibility ? String(payload.visibility) : null;
  const extendsFilter = payload?.extends ? String(payload.extends) : null;
  const extendsOnly = payload?.extendsOnly;
  const riskOnly = payload?.riskOnly;
  const targetPaths = Array.isArray(payload?.paths)
    ? payload.paths.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const extFilter = payload?.ext ? String(payload.ext) : null;
  const langFilter = payload?.lang ? String(payload.lang) : null;
  const filterExpr = payload?.filter ? String(payload.filter) : null;
  const opts = {
    mode,
    backend,
    ann,
    top,
    context,
    typeFilter,
    authorFilter,
    importFilter,
    callsFilter,
    usesFilter,
    signatureFilter,
    paramFilter,
    decoratorFilter,
    inferredTypeFilter,
    returnTypeFilter,
    throwsFilter,
    readsFilter,
    writesFilter,
    mutatesFilter,
    aliasFilter,
    awaitsFilter,
    riskFilter,
    riskTagFilter,
    riskSourceFilter,
    riskSinkFilter,
    riskCategoryFilter,
    riskFlowFilter,
    branchesMin,
    loopsMin,
    breaksMin,
    continuesMin,
    churnMin,
    chunkAuthorFilter,
    modifiedAfter,
    modifiedSince,
    visibilityFilter,
    extendsFilter,
    extendsOnly,
    riskOnly,
    targetPaths,
    extFilter,
    langFilter,
    filterExpr
  };
  for (const [key, value] of Object.entries(opts)) {
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    if (key === 'targetPaths') {
      for (const entry of value) {
        searchArgs.push('--path', entry);
      }
      continue;
    }
    if (key === 'extFilter') {
      searchArgs.push('--ext', value);
      continue;
    }
    if (key === 'langFilter') {
      searchArgs.push('--lang', value);
      continue;
    }
    if (key === 'filterExpr') {
      searchArgs.push('--filter', value);
      continue;
    }
    if (typeof value === 'boolean') {
      if (value) searchArgs.push(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
      continue;
    }
    searchArgs.push(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, String(value));
  }
  return { ok: true, args: searchArgs, query };
};

export const isNoIndexError = (err) => {
  if (!err) return false;
  if (err.code === 'ERR_INDEX_NOT_FOUND') return true;
  const message = String(err.message || '').toLowerCase();
  return message.includes('index not found') || message.includes('build index');
};
