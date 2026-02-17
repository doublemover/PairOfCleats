import { createError, ERROR_CODES, isErrorCode } from '../../shared/error-codes.js';
import { formatHealthFailure, runRetrievalHealthChecks } from '../../shared/ops-health.js';

export const inferJsonOutputFromArgs = (rawArgs) => {
  if (!Array.isArray(rawArgs)) return { jsonOutput: false };
  const hasFlag = (name) =>
    rawArgs.some((arg) => typeof arg === 'string' && (arg === name || arg.startsWith(`${name}=`)));
  const jsonOutput = hasFlag('--json');
  return { jsonOutput };
};

/**
 * Build common CLI runner helpers for error handling, cancellation, and health
 * checks.
 *
 * @param {object} input
 * @returns {{emitError:Function,bail:Function,throwIfAborted:Function,ensureRetrievalHealth:Function}}
 */
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

  const ensureRetrievalHealth = ({
    query,
    runCode,
    runProse,
    runExtractedProse,
    runRecords,
    backendLabel
  } = {}) => {
    // Fail fast with machine-readable health codes before hot-path retrieval.
    const report = runRetrievalHealthChecks({
      query,
      runCode,
      runProse,
      runExtractedProse,
      runRecords,
      backendLabel
    });
    if (report.ok) return report;
    const firstFailure = report.failures[0] || null;
    const message = formatHealthFailure(firstFailure);
    emitError(message, ERROR_CODES.CAPABILITY_MISSING);
    recordSearchMetrics('error');
    const error = createError(ERROR_CODES.CAPABILITY_MISSING, message);
    error.healthReport = report;
    error.healthCode = firstFailure?.code || null;
    error.emitted = true;
    throw error;
  };

  return {
    emitError,
    bail,
    throwIfAborted,
    ensureRetrievalHealth
  };
};
