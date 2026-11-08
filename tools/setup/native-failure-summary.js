import { readErrorDataProperty } from '../../src/shared/error-data.js';
import { createStorageObservationLedger } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';

const ownData = (value, key) => {
  if (value === null || !['object', 'function'].includes(typeof value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor : null;
};

/** Keep the actual producer packet and scheduler row, including explicit falsey
 * exceptions. Bounded message text is a projection, never their replacement.
 */
export const nativeFailureEntry = ({ pkgName, result, row = null, missing = false, phase }) => {
  const original = row && (row.status === 'failed' || row.status === 'cancelled' && row.error !== null)
    ? ownData(row, 'error') : ownData(result, 'error');
  const message = readErrorDataProperty(result, 'message') ?? readErrorDataProperty(original?.value, 'message');
  return Object.freeze({ pkgName, phase, missing, required: row?.required !== false, status: row?.status ?? 'failed',
    message: typeof message === 'string' ? message.slice(0, 4096) : missing ? 'required package is missing' : 'required native operation failed',
    result, row, ...(original ? { error: original.value } : {}),
    diagnosticsPath: readErrorDataProperty(result, 'diagnosticsPath') ?? readErrorDataProperty(original?.value, 'diagnosticsPath') ?? null });
};

/** The terminal domain error retains every original failure and live resource
 * observer. A diagnostic AggregateError alone cannot carry those prerequisites.
 */
export const createNativeFailureError = (message, code, { failures = [], results = [], repairFailures, history } = {}) => {
  const originals = [], observations = createStorageObservationLedger();
  const ordered = [...failures.filter(entry => entry.status === 'failed' && entry.required !== false),
    ...failures.filter(entry => entry.status === 'failed' && entry.required === false),
    ...failures.filter(entry => entry.status !== 'failed')];
  for (const entry of ordered) {
    const original = ownData(entry, 'error');
    if (original) originals.push(original.value);
    else if (entry.status !== 'blocked' && entry.result != null) originals.push(entry.result);
  }
  for (const original of originals) observations.remember(original);
  for (const entry of history || []) {
    const original = ownData(entry, 'error');
    if (original) observations.remember(original.value);
    else if (entry.result != null) observations.remember(entry.result);
  }
  const error = originals.length ? new AggregateError(originals, message, { cause: originals[0] }) : new Error(message);
  Object.assign(error, { code, failures: Object.freeze([...failures]), results: Object.freeze([...results]),
    ...(repairFailures === undefined ? {} : { repairFailures }) });
  if (history) error.history = Object.freeze([...history]);
  const snapshot = observations.snapshot();
  return snapshot.observerCount || snapshot.contextCount || !snapshot.complete ? addStorageFailureContext(error, {
    cacheOwnershipPending: true, cacheOwnershipReleased: observations.isSettled
  }) : error;
};
