import { log, logError } from '../../../src/shared/progress.js';

export const emitBenchLog = (onLog, message, level = 'info') => {
  if (typeof onLog === 'function') {
    onLog(message, level);
    return;
  }
  if (level === 'error') {
    logError(message);
    return;
  }
  if (level === 'warn') {
    log(`[warn] ${message}`);
    return;
  }
  log(message);
};
