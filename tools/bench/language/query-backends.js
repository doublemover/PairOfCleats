const SQLITE_BACKENDS = new Set(['sqlite', 'sqlite-fts', 'fts']);
const normalizeBackend = (value) => String(value || '').trim().toLowerCase();
const PRIMARY_MODES = Object.freeze(['code', 'prose']);

export const isSqliteBackend = (backend) => SQLITE_BACKENDS.has(normalizeBackend(backend));

export const resolveBenchQueryBackends = ({ requestedBackends = [], sqliteModes = {}, sqlitePaths = {},
  requestedModes = PRIMARY_MODES } = {}) => {
  const normalizedBackends = Array.isArray(requestedBackends)
    ? requestedBackends.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
  const modes = Array.from(new Set(requestedModes));
  if (!modes.length || modes.some((mode) => !PRIMARY_MODES.includes(mode))) {
    throw new Error('Benchmark primary query modes must select code and/or prose.');
  }
  const hasRequestedSqlite = normalizedBackends.some(isSqliteBackend);
  const availableModes = [];
  const emptyModes = [];
  const missingModes = [];
  const missingNonZeroModes = [];
  const missingModePaths = [];
  if (hasRequestedSqlite) {
    for (const mode of modes) {
      const status = sqliteModes?.[mode] || {};
      if (status.dbExists === true) { availableModes.push(mode); continue; }
      missingModes.push(mode);
      if (status.zeroState === true) emptyModes.push(mode);
      else {
        missingNonZeroModes.push(mode);
        if (typeof sqlitePaths[mode] === 'string' && sqlitePaths[mode].trim()) missingModePaths.push(`${mode}=${sqlitePaths[mode]}`);
      }
    }
  }
  const emptySqliteWorkload = hasRequestedSqlite && !availableModes.length && !missingNonZeroModes.length;
  const backends = emptySqliteWorkload ? normalizedBackends.filter((backend) => !isSqliteBackend(backend)) : normalizedBackends;
  const reason = missingNonZeroModes.length
    ? `SQLite backends requested but indexes are missing (${missingModePaths.join(', ') || missingNonZeroModes.join(', ')}).` : null;
  const warning = emptyModes.length
    ? emptySqliteWorkload
      ? `SQLite query backends not exercised: selected primary modes are empty (${emptyModes.join(', ')}).`
      : `SQLite queries retain available mode(s) ${availableModes.join(', ')}; empty mode(s) ${emptyModes.join(', ')} are not queried.` : null;
  const selectedModesByBackend = Object.fromEntries(backends.map((backend) => [backend,
    isSqliteBackend(backend) ? availableModes : modes]));
  const searchModeByBackend = Object.fromEntries(backends.map((backend) => [backend,
    selectedModesByBackend[backend].length === 1 ? selectedModesByBackend[backend][0] : null]));
  return { backends, skippedSqlite: emptySqliteWorkload, emptySqliteWorkload, reason, warning, missingModes,
    coverage: { requestedPrimaryModes: modes, selectedPrimaryModesByBackend: selectedModesByBackend,
      selectedSearchModeByBackend: searchModeByBackend, emptySqliteModes: emptyModes,
      skippedSqliteBackends: normalizedBackends.filter((backend) => emptySqliteWorkload && isSqliteBackend(backend)),
      missingNonZeroSqliteModes: missingNonZeroModes } };
};
