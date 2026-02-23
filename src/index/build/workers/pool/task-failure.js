import util from 'node:util';

const INSPECT_ERROR_OPTIONS = Object.freeze({
  depth: 4,
  breakLength: 120,
  showHidden: true,
  getters: true
});
const INSPECT_NESTED_ERROR_OPTIONS = Object.freeze({
  depth: 3,
  breakLength: 120,
  showHidden: true,
  getters: true
});

const inspectError = (value, options) => util.inspect(value, options);

const serializeNestedError = (err) => ({
  message: err?.message || String(err),
  stack: err?.stack || null,
  name: err?.name || null,
  code: err?.code || null,
  raw: inspectError(err, INSPECT_NESTED_ERROR_OPTIONS)
});

const serializeCrashError = (err) => ({
  stack: err?.stack || null,
  name: err?.name || null,
  code: err?.code || null,
  raw: inspectError(err, INSPECT_ERROR_OPTIONS),
  errors: Array.isArray(err?.errors)
    ? err.errors.map((inner) => serializeNestedError(inner))
    : null,
  cause: err?.cause
    ? serializeNestedError(err.cause)
    : null
});

/**
 * Classify a worker run failure into restart/disabling policy buckets.
 *
 * Subtle behavior: opaque `Error` failures are treated as non-recoverable.
 * This preserves the existing safety policy that avoids infinite restart loops
 * when workers fail without actionable diagnostics.
 *
 * @param {object} [input]
 * @param {unknown} input.err
 * @param {(err:unknown)=>string} [input.summarizeError]
 * @returns {{detail:string,opaqueFailure:boolean,isCloneError:boolean,reason:string}}
 */
export const classifyWorkerRunError = (input = {}) => {
  const {
    err,
    summarizeError = (value) => value?.message || String(value)
  } = input;
  const detail = summarizeError(err);
  const opaqueFailure = !detail || detail === 'Error';
  const errorName = err?.name || '';
  const loweredName = errorName.toLowerCase();
  const isCloneError = loweredName.includes('dataclone')
    || loweredName.includes('datacloneerror')
    || loweredName.includes('dataclone');
  const reason = detail || err?.message || String(err);
  return { detail, opaqueFailure, isCloneError, reason };
};

/**
 * Shared worker-task failure handling and crash logging.
 *
 * Restart behavior is centralized here so tokenize/quantize task paths cannot
 * diverge: clone/opaque failures permanently disable the pool, while other
 * failures schedule a deferred restart once in-flight tasks drain.
 *
 * @param {object} [input]
 * @param {object} input.lifecycle
 * @param {(err:unknown)=>string} [input.summarizeError]
 * @param {object|null} [input.crashLogger]
 * @param {(poolForMeta:object,assign:(meta:object)=>void,fn:(meta:object)=>unknown)=>unknown} input.withPooledPayloadMeta
 * @returns {{
 *   reportUnavailable:(input:{phase:string,task:string,payload:object|null,payloadMetaPool:object,assignPayloadMeta:(target:object,payload:object|null)=>void})=>void,
 *   handleRunFailure:(input:{err:unknown,phase:string,task:string,payload:object|null,payloadMetaPool:object,assignPayloadMeta:(target:object,payload:object|null)=>void,message?:string})=>Promise<void>
 * }}
 */
export const createWorkerTaskFailureHandler = (input = {}) => {
  const {
    lifecycle,
    summarizeError = (err) => err?.message || String(err),
    crashLogger = null,
    withPooledPayloadMeta
  } = input;

  const reportUnavailable = ({
    phase,
    task,
    payload,
    payloadMetaPool,
    assignPayloadMeta
  }) => {
    if (!crashLogger?.enabled) return;
    withPooledPayloadMeta(payloadMetaPool, (meta) => {
      assignPayloadMeta(meta, payload);
    }, (payloadMeta) => {
      crashLogger.logError({
        phase,
        message: 'worker pool unavailable',
        stack: null,
        name: 'Error',
        code: null,
        task,
        payloadMeta: payload ? payloadMeta : null
      });
    });
  };

  const handleRunFailure = async ({
    err,
    phase,
    task,
    payload,
    payloadMetaPool,
    assignPayloadMeta,
    message
  }) => {
    const { detail, opaqueFailure, isCloneError, reason } = classifyWorkerRunError({
      err,
      summarizeError
    });
    if (isCloneError) {
      await lifecycle.disablePermanently(reason || 'data-clone error');
    } else if (opaqueFailure) {
      await lifecycle.disablePermanently(reason || 'worker failure');
    } else {
      await lifecycle.scheduleRestart(reason);
    }
    if (!crashLogger?.enabled) return;
    withPooledPayloadMeta(payloadMetaPool, (meta) => {
      assignPayloadMeta(meta, payload);
    }, (payloadMeta) => {
      crashLogger.logError({
        phase,
        message: message || detail || err?.message || String(err),
        task,
        payloadMeta: payload ? payloadMeta : null,
        ...serializeCrashError(err)
      });
    });
  };

  return {
    reportUnavailable,
    handleRunFailure
  };
};
