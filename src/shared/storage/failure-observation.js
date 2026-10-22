import { addStorageFailureContext } from './operation-error.js';

const retainedFailures = new WeakSet();
const asError = value => value !== null && ['object', 'function'].includes(typeof value) ? value : new Error(String(value), { cause: value });
export const isStorageObservationFailure = value => value !== null && ['object', 'function'].includes(typeof value)
  && retainedFailures.has(value);

/** Classification never settles a resource. Capture the actual original
 * observation before inspecting report fields or returning an ordinary diagnostic.
 */
export const observeStorageResource = (value, { phase = 'storage-failure', phaseField = 'storageFailurePhase' } = {}) => {
  const primary = asError(value), inspections = [];
  let original, marker, unreadable = false;
  try { original = primary.cacheOwnershipReleased; } catch (error) { unreadable = true; inspections.push(error); }
  try { marker = primary.cacheOwnershipPending; } catch (error) { unreadable = true; inspections.push(error); }
  const observed = unreadable || marker === true || typeof original === 'function';
  const originalSettled = () => !unreadable && (!observed || typeof original === 'function' && original.call(primary) === true);
  const retain = (inspection, { inspectionPresent = false, inspectionPrimary = false } = {}) => {
    const fields = { [phaseField]: phase,
      ...(observed ? { cacheOwnershipPending: true, cacheOwnershipReleased: originalSettled } : {}) };
    const first = inspectionPrimary && inspectionPresent ? asError(inspection) : primary;
    const candidate = inspectionPrimary ? primary : inspection;
    const secondary = inspectionPresent && candidate !== first ? candidate : Object.freeze(Object.assign(
      new Error('Original resource observation remains retained.'), {
        cacheOwnershipPending: observed, cacheOwnershipReleased: originalSettled
      }));
    let failure = addStorageFailureContext(first, fields, secondary, { secondaryPresent: true });
    for (const error of inspections) failure = addStorageFailureContext(failure, {}, error, { secondaryPresent: true });
    const observe = Object.getOwnPropertyDescriptor(failure, 'cacheOwnershipReleased')?.value;
    Object.defineProperties(failure, { cacheOwnershipPending: { value: true, writable: false, configurable: false },
      cacheOwnershipReleased: { value: observe, writable: false, configurable: false } });
    retainedFailures.add(failure); return failure;
  };
  const requireSettled = () => {
    if (unreadable) throw retain();
    let confirmed;
    try { confirmed = originalSettled(); }
    catch (inspection) { throw retain(inspection, { inspectionPresent: true }); }
    if (!confirmed) throw retain();
  };
  return Object.freeze({ primary, retain, requireSettled });
};

/** A report is safe only after the original resource observation is confirmed.
 * Strings are projected without coercing arbitrary diagnostic objects.
 */
export const describeStorageFailure = (value, { phase = 'storage-failure',
  defaultCode = 'ERR_STORAGE', defaultMessage = 'Storage observation failed.' } = {}) => {
  const observation = observeStorageResource(value, { phase });
  observation.requireSettled();
  let code, message;
  try { code = observation.primary.code; message = observation.primary.message; }
  catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled();
  return { code: typeof code === 'string' && code ? code : defaultCode,
    message: typeof message === 'string' ? message : defaultMessage };
};

