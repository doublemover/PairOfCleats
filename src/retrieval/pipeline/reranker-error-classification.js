import { captureRerankerFailure } from '../rerankers/failure-inspection.js';
import { preserveRerankerFailure } from '../rerankers/failure-ownership.js';

const cancellations = new WeakMap();
const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const cancellationFlag = primary => {
  if (!objectLike(primary)) return { cancelled: false, inspection: null, hasInspection: false };
  if (cancellations.has(primary)) return cancellations.get(primary);
  let cancelled = false, inspection = null, hasInspection = false;
  try { cancelled = Boolean(primary.cancelled); }
  catch (error) { inspection = captureRerankerFailure(error); hasInspection = true; }
  const captured = Object.freeze({ cancelled, inspection, hasInspection });
  cancellations.set(primary, captured);
  return captured;
};

/** Classification never reads original diagnostic getters a second time.
 * Pending native/inspection ownership is a failure, even with fallback enabled.
 * Ordinary original pending failures retain their existing exact identity. */
export const classifyRerankerError = primary => {
  const captured = captureRerankerFailure(primary);
  const originalPending = captured.hasOwnership && !captured.released();
  const abort = captured.name === 'AbortError' || captured.code === 'ABORT_ERR';
  // Match the original admission order: pending ownership precedes cancellation.
  const cancellation = originalPending || abort ? { cancelled: false, inspection: null, hasInspection: false }
    : cancellationFlag(primary);
  const inspection = cancellation.inspection;
  const released = () => captured.released() && (!inspection || inspection.released());
  const hasOwnership = captured.hasOwnership || inspection?.hasOwnership === true;
  const extraInspection = cancellation.hasInspection ? [inspection.primary] : [];
  const needsProjection = captured.inspectionErrors.length > 0 || cancellation.hasInspection
    || primary === null || typeof primary !== 'object';
  const error = needsProjection ? preserveRerankerFailure(primary, {
    cancelled: { value: cancellation.cancelled },
    rerankerDiagnosticErrors: { value: Object.freeze([...captured.inspectionErrors, ...extraInspection]) },
    ...(hasOwnership ? { cacheOwnershipPending: { get: () => !released() }, cacheOwnershipReleased: { value: released } } : {})
  }) : primary;
  return Object.freeze({ error, pending: hasOwnership && !released(),
    abort,
    cancelled: cancellation.cancelled,
    reason: typeof captured.code === 'string' && captured.code ? captured.code : captured.message || 'adapter-error' });
};
