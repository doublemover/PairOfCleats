import { normalizeString } from './core.js';

export function getTuiEnvConfig(env = process.env) {
  return {
    runId: normalizeString(env.PAIROFCLEATS_TUI_RUN_ID),
    eventLogDir: normalizeString(env.PAIROFCLEATS_TUI_EVENT_LOG_DIR),
    installRoot: normalizeString(env.PAIROFCLEATS_TUI_INSTALL_ROOT)
  };
}
