export const buildSearchParams = (_repoPath, payload, defaultOutput) => {
  const normalizeMetaFilters = (meta) => {
    if (!meta) return null;
    if (Array.isArray(meta)) {
      const entries = meta.flatMap((entry) => {
        if (entry == null) return [];
        if (typeof entry === 'string') return [entry];
        if (typeof entry === 'object') {
          return Object.entries(entry).map(([key, value]) =>
            value == null || value === '' ? String(key) : `${key}=${value}`
          );
        }
        return [String(entry)];
      });
      return entries.length ? entries : null;
    }
    if (typeof meta === 'object') {
      const entries = Object.entries(meta).map(([key, value]) =>
        value == null || value === '' ? String(key) : `${key}=${value}`
      );
      return entries.length ? entries : null;
    }
    return [String(meta)];
  };
  const normalizeMetaJson = (value) => {
    if (value == null || value === '') return null;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const query = payload?.query ? String(payload.query) : '';
  if (!query) {
    return { ok: false, message: 'Missing query.' };
  }
  const output = payload?.output || defaultOutput;
  const useCompact = output !== 'full' && output !== 'json';
  const searchArgs = ['--json'];
  if (useCompact) searchArgs.push('--compact');
  const mode = payload?.mode ? String(payload.mode) : null;
  const backend = payload?.backend ? String(payload.backend) : null;
  const ann = payload?.ann;
  const top = Number.isFinite(Number(payload?.top)) ? Number(payload.top) : null;
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
  const churnMin = payload?.churnMin;
  const chunkAuthorFilter = payload?.chunkAuthor ? String(payload.chunkAuthor) : null;
  const modifiedAfter = payload?.modifiedAfter ? String(payload.modifiedAfter) : null;
  const modifiedSince = Number.isFinite(Number(payload?.modifiedSince)) ? Number(payload.modifiedSince) : null;
  const visibilityFilter = payload?.visibility ? String(payload.visibility) : null;
  const extendsFilter = payload?.extends ? String(payload.extends) : null;
  const targetPaths = Array.isArray(payload?.paths)
    ? payload.paths.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const extFilter = payload?.ext ? String(payload.ext) : null;
  const langFilter = payload?.lang ? String(payload.lang) : null;
  const filterExpr = payload?.filter ? String(payload.filter) : null;
  const metaFilters = normalizeMetaFilters(payload?.meta);
  const metaJsonFilter = normalizeMetaJson(payload?.metaJson);
  const contextLines = Number.isFinite(Number(payload?.context)) ? Math.max(0, Number(payload.context)) : null;

  const pushFlag = (flag, value) => {
    if (value == null || value === '') return;
    searchArgs.push(flag, String(value));
  };
  if (mode) searchArgs.push('--mode', mode);
  if (backend) searchArgs.push('--backend', backend);
  if (ann === true) searchArgs.push('--ann');
  if (ann === false) searchArgs.push('--no-ann');
  if (top != null) searchArgs.push('--top', String(top));
  if (contextLines != null) searchArgs.push('--context', String(contextLines));
  pushFlag('--type', typeFilter);
  pushFlag('--author', authorFilter);
  pushFlag('--import', importFilter);
  pushFlag('--calls', callsFilter);
  pushFlag('--uses', usesFilter);
  pushFlag('--signature', signatureFilter);
  pushFlag('--param', paramFilter);
  pushFlag('--decorator', decoratorFilter);
  pushFlag('--inferred-type', inferredTypeFilter);
  pushFlag('--return-type', returnTypeFilter);
  pushFlag('--throws', throwsFilter);
  pushFlag('--reads', readsFilter);
  pushFlag('--writes', writesFilter);
  pushFlag('--mutates', mutatesFilter);
  pushFlag('--alias', aliasFilter);
  pushFlag('--awaits', awaitsFilter);
  pushFlag('--risk', riskFilter);
  pushFlag('--risk-tag', riskTagFilter);
  pushFlag('--risk-source', riskSourceFilter);
  pushFlag('--risk-sink', riskSinkFilter);
  pushFlag('--risk-category', riskCategoryFilter);
  pushFlag('--risk-flow', riskFlowFilter);
  if (branchesMin != null) searchArgs.push('--branches', String(branchesMin));
  if (loopsMin != null) searchArgs.push('--loops', String(loopsMin));
  if (breaksMin != null) searchArgs.push('--breaks', String(breaksMin));
  if (continuesMin != null) searchArgs.push('--continues', String(continuesMin));
  if (churnMin != null) searchArgs.push('--churn', String(churnMin));
  pushFlag('--chunk-author', chunkAuthorFilter);
  pushFlag('--modified-after', modifiedAfter);
  if (modifiedSince != null) searchArgs.push('--modified-since', String(modifiedSince));
  pushFlag('--visibility', visibilityFilter);
  pushFlag('--extends', extendsFilter);
  for (const entry of targetPaths) {
    searchArgs.push('--path', entry);
  }
  pushFlag('--ext', extFilter);
  pushFlag('--lang', langFilter);
  pushFlag('--filter', filterExpr);
  if (Array.isArray(metaFilters)) {
    metaFilters.forEach((entry) => pushFlag('--meta', entry));
  }
  pushFlag('--meta-json', metaJsonFilter);
  return { ok: true, args: searchArgs, query };
};

export const isNoIndexError = (err) => {
  if (!err) return false;
  if (err.code === 'ERR_INDEX_NOT_FOUND') return true;
  const message = String(err.message || '').toLowerCase();
  return message.includes('index not found') || message.includes('build index');
};
