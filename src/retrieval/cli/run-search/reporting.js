import { ERROR_CODES, isErrorCode } from '../../../shared/error-codes.js';

/**
 * Emit JSON error payload when CLI output mode requires machine-readable errors.
 *
 * @param {{
 *   err:any,
 *   emitOutput:boolean,
 *   jsonOutput:boolean
 * }} input
 */
export const emitSearchJsonError = ({
  err,
  emitOutput,
  jsonOutput
}) => {
  if (!emitOutput || !jsonOutput || err?.emitted) return;
  let message = err?.message || 'Search failed.';
  if (err?.code && String(err.code).startsWith('ERR_MANIFEST')
    && !String(message).toLowerCase().includes('manifest')) {
    message = message && message !== 'Search failed.'
      ? `Manifest error: ${message}`
      : 'Missing pieces manifest.';
  }
  const code = isErrorCode(err?.code) ? err.code : ERROR_CODES.INTERNAL;
  console.log(JSON.stringify({ ok: false, code, message }));
  if (err) err.emitted = true;
};

/**
 * Flush run-search finalizers that should never fail the CLI request.
 *
 * @param {{
 *   telemetry:object|null,
 *   emitOutput:boolean,
 *   queryPlanCache:object|null
 * }} input
 * @returns {Promise<void>}
 */
export const flushRunSearchResources = async ({
  telemetry,
  emitOutput,
  queryPlanCache
}) => {
  if (telemetry?.emitResourceWarnings) {
    telemetry.emitResourceWarnings({
      warn: (message) => {
        if (emitOutput) console.warn(message);
      }
    });
  }
  if (typeof queryPlanCache?.persist === 'function') {
    try {
      await queryPlanCache.persist();
    } catch {}
  }
};
