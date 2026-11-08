import { redactDiagnosticText } from '../../src/shared/diagnostic-text.js';

/** Diagnostic projection only. Unreadable observations stay pending; this never
 * manufactures settlement, retries an operation, or releases a retained owner.
 */
export const toolingFailureReport = (value, { signal = null, fallbackCode = 'ERR_TOOLING_OPERATION' } = {}) => {
  let unreadable = false;
  const read = field => {
    try { return value?.[field]; }
    catch { unreadable = true; return null; }
  };
  const marker = read('cacheOwnershipPending'), observer = read('cacheOwnershipReleased');
  const code = read('code'), message = read('message');
  let released = false;
  if (typeof observer === 'function') {
    try { released = observer.call(value) === true; } catch { unreadable = true; }
  }
  const pending = unreadable || (marker === true || typeof observer === 'function') && !released;
  return { ok: false, state: pending ? 'settlement-pending' : signal?.aborted ? 'cancelled' : 'blocked',
    error: { code: typeof code === 'string' ? code : fallbackCode,
      message: redactDiagnosticText(typeof message === 'string' ? message : 'Selected tooling operation failed; inspect its retained transaction evidence.', 2048) } };
};
