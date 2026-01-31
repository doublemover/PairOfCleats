import { createError, ERROR_CODES, isErrorCode } from '../../shared/error-codes.js';

export const inferJsonOutputFromArgs = (rawArgs) => {
  if (!Array.isArray(rawArgs)) return { jsonOutput: false };
  const hasFlag = (name) =>
    rawArgs.some((arg) => typeof arg === 'string' && (arg === name || arg.startsWith(`${name}=`)));
  const jsonOutput = hasFlag('--json');
  return { jsonOutput };
};

export const createRunnerHelpers = ({ emitOutput, exitOnError, jsonOutput, recordSearchMetrics, signal }) => {
  const emitError = (message, errorCode) => {
    if (!emitOutput || !message) return;
    if (jsonOutput) {
      console.log(JSON.stringify({ ok: false, code: errorCode, message }, null, 2));
    } else {
      console.error(message);
    }
  };

  const bail = (message, code = 1, errorCode = ERROR_CODES.INTERNAL) => {
    const resolvedCode = isErrorCode(errorCode) ? errorCode : ERROR_CODES.INTERNAL;
    emitError(message, resolvedCode);
    if (exitOnError) process.exit(code);
    recordSearchMetrics('error');
    const error = createError(resolvedCode, message || 'Search failed.');
    error.emitted = true;
    throw error;
  };

  const throwIfAborted = () => {
    if (!signal?.aborted) return;
    const error = createError(ERROR_CODES.CANCELLED, 'Search cancelled.');
    error.cancelled = true;
    throw error;
  };

  return {
    emitError,
    bail,
    throwIfAborted
  };
};
