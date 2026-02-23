const readUniqueModeValues = (resolved, modes, selector) => {
  const values = modes
    .map((mode) => selector(resolved, mode))
    .filter((value) => value != null);
  return [...new Set(values)];
};

export const parseCreatedAtMs = (value) => {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
};

export const sortDiffEntries = (entries) => (
  [...entries].sort((left, right) => {
    const leftMs = parseCreatedAtMs(left.createdAt);
    const rightMs = parseCreatedAtMs(right.createdAt);
    if (leftMs !== rightMs) return rightMs - leftMs;
    return String(left.id || '').localeCompare(String(right.id || ''));
  })
);

export const buildDiffEndpoint = ({ resolved, modes }) => {
  const endpoint = { ref: resolved.canonical };
  if (resolved.identity?.snapshotId) endpoint.snapshotId = resolved.identity.snapshotId;
  const buildIds = modes
    .map((mode) => resolved.identity?.buildIdByMode?.[mode])
    .filter((value) => typeof value === 'string' && value);
  const uniqueBuildIds = [...new Set(buildIds)];
  if (uniqueBuildIds.length === 1) endpoint.buildId = uniqueBuildIds[0];
  if (resolved.parsed?.kind === 'path') endpoint.indexRootRef = resolved.parsed.canonical;
  return endpoint;
};

export const compareCompat = ({ fromResolved, toResolved, modes }) => {
  const configMismatches = [];
  const toolMismatches = [];
  for (const mode of modes) {
    const fromConfig = fromResolved.identity?.configHashByMode?.[mode] ?? null;
    const toConfig = toResolved.identity?.configHashByMode?.[mode] ?? null;
    if (fromConfig && toConfig && fromConfig !== toConfig) {
      configMismatches.push({ mode, from: fromConfig, to: toConfig });
    }
    const fromTool = fromResolved.identity?.toolVersionByMode?.[mode] ?? null;
    const toTool = toResolved.identity?.toolVersionByMode?.[mode] ?? null;
    if (fromTool && toTool && fromTool !== toTool) {
      toolMismatches.push({ mode, from: fromTool, to: toTool });
    }
  }
  return {
    configHashMismatch: configMismatches.length > 0,
    toolVersionMismatch: toolMismatches.length > 0,
    configMismatches,
    toolMismatches
  };
};

export const buildCompactConfigValue = (resolved, modes) => {
  const unique = readUniqueModeValues(
    resolved,
    modes,
    (entry, mode) => entry.identity?.configHashByMode?.[mode] ?? null
  );
  return unique.length === 1 ? unique[0] : null;
};

export const buildCompactToolValue = (resolved, modes) => {
  const unique = readUniqueModeValues(
    resolved,
    modes,
    (entry, mode) => entry.identity?.toolVersionByMode?.[mode] ?? null
  );
  return unique.length === 1 ? unique[0] : null;
};
