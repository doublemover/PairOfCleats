const MODE_KEYS = ['code', 'prose', 'extracted-prose', 'records'];

const buildEntry = (mode, desired, active, reason, explicit = false) => ({
  mode,
  desired,
  active,
  reason,
  explicit
});

export const resolveSqliteFtsRoutingByMode = ({
  useSqlite,
  sqliteFtsRequested,
  sqliteFtsExplicit,
  runCode,
  runProse,
  runExtractedProse,
  runRecords
} = {}) => {
  const enabled = useSqlite === true;
  const explicitFts = sqliteFtsExplicit === true;
  const requestedFts = sqliteFtsRequested === true;
  const routing = {
    fallbackOrder: ['sqlite-fts', 'js-bm25'],
    byMode: {}
  };

  for (const mode of MODE_KEYS) {
    const willRun = mode === 'code'
      ? runCode === true
      : mode === 'prose'
        ? runProse === true
        : mode === 'extracted-prose'
          ? runExtractedProse === true
          : runRecords === true;
    if (!willRun) continue;

    if (mode === 'records') {
      routing.byMode[mode] = buildEntry(mode, 'sparse', false, 'records_sparse_only', explicitFts);
      continue;
    }

    if (!enabled) {
      routing.byMode[mode] = buildEntry(mode, 'sparse', false, 'sqlite_unavailable', explicitFts);
      continue;
    }

    if (explicitFts) {
      routing.byMode[mode] = buildEntry(mode, 'fts', true, 'explicit_backend_sqlite_fts', true);
      continue;
    }

    if (mode === 'code') {
      routing.byMode[mode] = buildEntry(mode, 'sparse', false, 'default_code_sparse', requestedFts);
      continue;
    }

    routing.byMode[mode] = buildEntry(mode, 'fts', true, `default_${mode}_fts`, requestedFts);
  }

  return routing;
};
