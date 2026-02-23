import { updateSqliteState } from '../index-state.js';

const createBaseStatePayload = ({
  root,
  userConfig,
  indexRoot,
  mode,
  path,
  schemaVersion,
  threadLimits
}) => ({
  root,
  userConfig,
  indexRoot,
  mode,
  path,
  schemaVersion,
  threadLimits
});

export const setSqliteModeRunningState = async (options) => (
  updateSqliteState({
    ...createBaseStatePayload(options),
    status: 'running',
    note: null
  })
);

export const setSqliteModeSkippedEmptyState = async ({
  mode,
  zeroStateManifestPath,
  ...options
}) => (
  updateSqliteState({
    ...createBaseStatePayload({ mode, ...options }),
    status: 'ready',
    note: `skipped empty ${mode} rebuild`,
    stats: {
      skipped: true,
      reason: `empty-${mode}-artifacts`,
      zeroStateManifestPath
    }
  })
);

export const setSqliteModeIncrementalReadyState = async ({
  bytes,
  elapsedMs,
  stats,
  ...options
}) => (
  updateSqliteState({
    ...createBaseStatePayload(options),
    status: 'ready',
    bytes,
    inputBytes: 0,
    elapsedMs,
    note: 'incremental update',
    stats
  })
);

export const setSqliteModeBuildReadyState = async ({
  bytes,
  inputBytes,
  elapsedMs,
  note,
  stats,
  ...options
}) => (
  updateSqliteState({
    ...createBaseStatePayload(options),
    status: 'ready',
    bytes,
    inputBytes,
    elapsedMs,
    note,
    stats
  })
);

export const setSqliteModeVectorMissingState = async (options) => (
  updateSqliteState({
    ...createBaseStatePayload(options),
    status: 'ready',
    note: 'vector table missing after build'
  })
);

export const setSqliteModeFailedState = async ({
  error,
  ...options
}) => (
  updateSqliteState({
    ...createBaseStatePayload(options),
    status: 'failed',
    error
  })
);
