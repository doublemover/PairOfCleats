import { createToolDisplay } from '../../shared/cli-display.js';

export function createBuildEmbeddingsContext({ argv }) {
  const display = createToolDisplay({ argv, stream: process.stderr });
  let stopHeartbeat = () => {};
  let finalized = false;
  let displayClosed = false;
  const closeDisplay = () => {
    if (displayClosed) return;
    displayClosed = true;
    display.close();
  };
  const finalize = () => {
    if (finalized) return;
    finalized = true;
    stopHeartbeat();
    closeDisplay();
  };
  process.once('exit', finalize);
  const log = (message, meta = null) => {
    if (meta?.kind === 'status' && typeof display?.logLine === 'function') {
      display.logLine(message, meta);
      return;
    }
    display.log(message, meta);
  };
  const warn = (message, meta = null) => display.warn(message, meta);
  const error = (message, meta = null) => display.error(message, meta);
  const logger = { log, warn, error };
  const fail = (message, code = 1) => {
    error(message);
    finalize();
    process.exit(code);
  };
  const setHeartbeat = (fn) => {
    stopHeartbeat = typeof fn === 'function' ? fn : () => {};
  };
  return {
    display,
    log,
    warn,
    error,
    logger,
    fail,
    finalize,
    setHeartbeat
  };
}
