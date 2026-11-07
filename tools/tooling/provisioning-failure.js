import { isStorageObservationFailure, observeStorageResource } from '../../src/shared/storage/failure-observation.js';

export const isProvisioningObservationFailure = isStorageObservationFailure;
export const observeProvisioningResource = (value, { phase = 'prerequisite-failure' } = {}) =>
  observeStorageResource(value, { phase, phaseField: 'provisioningFailurePhase' });

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
