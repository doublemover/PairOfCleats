import { resolveDispatchRuntimeEnv } from './dispatch-runtime-env.js';

const normalizeString = (value) => String(value || '').trim();

export const createTuiRunId = ({
  now = Date.now(),
  pid = process.pid
} = {}) => `tui-${Number(now).toString(36)}-${pid}`;

export const resolveTuiWrapperEnv = async ({
  runtimeRoot,
  tuiEnvConfig = {},
  installRoot = '',
  eventLogDir = '',
  baseEnv = process.env,
  runId = '',
  scriptPath = 'bin/pairofcleats-tui.js'
} = {}) => {
  const env = await resolveDispatchRuntimeEnv({
    root: runtimeRoot,
    scriptPath,
    baseEnv
  });
  const resolvedRunId = normalizeString(tuiEnvConfig.runId)
    || normalizeString(runId)
    || createTuiRunId();
  return {
    ...env,
    PAIROFCLEATS_TUI_RUN_ID: resolvedRunId,
    PAIROFCLEATS_TUI_INSTALL_ROOT: normalizeString(tuiEnvConfig.installRoot) || installRoot,
    PAIROFCLEATS_TUI_EVENT_LOG_DIR: normalizeString(tuiEnvConfig.eventLogDir) || eventLogDir
  };
};
