const SQLITE_BACKENDS = new Set(['sqlite', 'sqlite-fts', 'fts']);

const normalizeBackend = (value) => String(value || '').trim().toLowerCase();

const toSafeBoolean = (value) => value === true;

const modeOrder = Object.freeze(['code', 'prose']);

const formatModeList = (values) => (
  values
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .join(', ')
);

export const isSqliteBackend = (backend) => SQLITE_BACKENDS.has(normalizeBackend(backend));

export const resolveBenchQueryBackends = ({
  requestedBackends = [],
  sqliteModes = {},
  sqlitePaths = {}
} = {}) => {
  const normalizedBackends = Array.isArray(requestedBackends)
    ? requestedBackends.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const hasRequestedSqlite = normalizedBackends.some((backend) => isSqliteBackend(backend));
  if (!hasRequestedSqlite) {
    return {
      backends: normalizedBackends,
      skippedSqlite: false,
      reason: null,
      missingModes: []
    };
  }

  const missingModes = [];
  const missingZeroStateModes = [];
  const missingNonZeroModes = [];
  const missingModePaths = [];
  for (const mode of modeOrder) {
    const status = sqliteModes?.[mode] && typeof sqliteModes[mode] === 'object'
      ? sqliteModes[mode]
      : {};
    const dbExists = toSafeBoolean(status.dbExists);
    const zeroState = toSafeBoolean(status.zeroState);
    if (dbExists) continue;
    missingModes.push(mode);
    if (zeroState) missingZeroStateModes.push(mode);
    else missingNonZeroModes.push(mode);
    const dbPath = sqlitePaths?.[mode];
    if (typeof dbPath === 'string' && dbPath.trim()) {
      missingModePaths.push(`${mode}=${dbPath}`);
    }
  }

  if (!missingModes.length) {
    return {
      backends: normalizedBackends,
      skippedSqlite: false,
      reason: null,
      missingModes: []
    };
  }

  if (missingNonZeroModes.length > 0) {
    const suffix = missingModePaths.length
      ? missingModePaths.join(', ')
      : formatModeList(missingNonZeroModes);
    return {
      backends: normalizedBackends,
      skippedSqlite: false,
      reason: `SQLite backends requested but indexes are missing (${suffix}).`,
      missingModes
    };
  }

  return {
    backends: normalizedBackends.filter((backend) => !isSqliteBackend(backend)),
    skippedSqlite: true,
    reason: `SQLite backends skipped for zero-state mode(s): ${formatModeList(missingZeroStateModes)}.`,
    missingModes
  };
};
