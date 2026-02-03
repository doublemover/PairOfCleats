import { createDisplay } from '../../../src/shared/cli/display.js';

export function createBuildEmbeddingsContext({ argv }) {
  const display = createDisplay({
    stream: process.stderr,
    progressMode: argv.progress,
    verbose: argv.verbose === true,
    quiet: argv.quiet === true
  });
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
  const log = (message) => display.log(message);
  const warn = (message) => display.warn(message);
  const error = (message) => display.error(message);
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
