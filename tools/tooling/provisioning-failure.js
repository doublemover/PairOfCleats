import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';

const retainedFailures = new WeakSet();
const asError = value => value !== null && ['object', 'function'].includes(typeof value) ? value : new Error(String(value), { cause: value });
export const isProvisioningObservationFailure = value => value !== null && ['object', 'function'].includes(typeof value)
  && retainedFailures.has(value);

/** Classification never settles a resource. Capture the actual original
 * observation before inspecting report fields or selecting another probe.
 */
export const observeProvisioningResource = (value, { phase = 'prerequisite-failure' } = {}) => {
  const primary = asError(value), inspections = [];
  let original, marker, unreadable = false;
  try { original = primary.cacheOwnershipReleased; } catch (error) { unreadable = true; inspections.push(error); }
  try { marker = primary.cacheOwnershipPending; } catch (error) { unreadable = true; inspections.push(error); }
  const observed = unreadable || marker === true || typeof original === 'function';
  const originalSettled = () => !unreadable && (!observed || typeof original === 'function' && original.call(primary) === true);
  const retain = (inspection, { inspectionPresent = false, inspectionPrimary = false } = {}) => {
    const fields = { provisioningFailurePhase: phase,
      ...(observed ? { cacheOwnershipPending: true, cacheOwnershipReleased: originalSettled } : {}) };
    const first = inspectionPrimary && inspectionPresent ? asError(inspection) : primary;
    const candidate = inspectionPrimary ? primary : inspection;
    const secondary = inspectionPresent && candidate !== first ? candidate : Object.freeze(Object.assign(
      new Error('Original prerequisite resource observation remains retained.'), {
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

export const describeProvisioningFailure = (value, { signal = null, includeResult = false } = {}) => {
  const observation = observeProvisioningResource(value);
  observation.requireSettled();
  if (signal?.aborted) throw observation.primary;
  let description;
  try {
    const original = observation.primary;
    const code = original.code;
    if (!includeResult) description = { code: typeof code === 'string' ? code : null };
    else {
      const name = original.name, result = original.result;
      const status = result?.exitCode, childSignal = result?.signal, stdout = result?.stdout, stderr = result?.stderr;
      description = { code: typeof code === 'string' ? code : null, name: typeof name === 'string' ? name : null,
        status: Number.isInteger(status) ? status : null, signal: typeof childSignal === 'string' ? childSignal : null,
        stdout: typeof stdout === 'string' ? stdout : '', stderr: typeof stderr === 'string' ? stderr : '' };
    }
  } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled();
  if (signal?.aborted) throw observation.primary;
  return description;
};
