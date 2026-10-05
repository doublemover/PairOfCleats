import { normalizeString } from './core.js';

/** Keep the wrapper-supplied workspace path intact, including significant spaces. */
export function getTuiWorkspaceRoot(env = process.env) {
  return env.PAIROFCLEATS_TUI_WORKSPACE_ROOT || '';
}

export function getTuiEnvConfig(env = process.env) {
  return {
    runId: normalizeString(env.PAIROFCLEATS_TUI_RUN_ID),
    eventLogDir: normalizeString(env.PAIROFCLEATS_TUI_EVENT_LOG_DIR),
    installRoot: normalizeString(env.PAIROFCLEATS_TUI_INSTALL_ROOT)
  };
}
