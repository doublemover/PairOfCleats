import { updateBuildState } from '../build-state.js';
import { patchRuntimeAttempt, RUNTIME_RECEIPT_VERSION } from '../../../shared/runtime-envelope/receipt.js';
import { assertRuntimeAttempt } from '../../../contracts/validators/runtime-receipt.js';
import { announceRuntimeExecutionBinding } from '../../../shared/runtime-envelope/execution-binding.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';

/** Critical provenance uses the existing required durability and lock owner. */
export const persistRuntimeAttempt = async (buildRoot, attempt, patch = {}, { write = updateBuildState } = {}) => {
  if (!buildRoot) throw Object.assign(new Error('Runtime receipt requires a selected build root.'), { code: 'ERR_RUNTIME_RECEIPT_ROOT' });
  const next = patchRuntimeAttempt(attempt, {
    ...patch, persistence: { status: 'durable', lastErrorCode: null }
  });
  assertRuntimeAttempt(next);
  try {
    const written = await write(buildRoot, { runtime: { schemaVersion: RUNTIME_RECEIPT_VERSION, latestAttemptId: next.attemptId, attempts: [next] } });
    const observation = observeStorageResource(written, { phase: 'runtime-receipt-write-result' });
    observation.requireSettled();
    let confirmed;
    try {
      const runtime = written?.runtime;
      confirmed = runtime?.schemaVersion === RUNTIME_RECEIPT_VERSION && Array.isArray(runtime.attempts)
        && runtime.attempts.some(value => value?.attemptId === next.attemptId && value.buildId === next.buildId
          && value.lifecycle === next.lifecycle && value.updatedAt === next.updatedAt);
    } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true, inspectionPrimary: true }); }
    observation.requireSettled();
    if (!confirmed) throw observation.wrap(Object.assign(new Error('Runtime receipt write did not confirm its admitted attempt.'), {
      code: 'ERR_RUNTIME_RECEIPT_WRITE_UNCONFIRMED'
    }));
  } catch (error) {
    const observation = observeStorageResource(error, { phase: 'runtime-receipt-persistence' });
    let code = 'UNKNOWN', inspection, inspectionPresent = false;
    const remember = value => {
      inspection = inspectionPresent ? addStorageFailureContext(inspection, {}, value, { secondaryPresent: true }) : value;
      inspectionPresent = true;
    };
    try {
      observation.requireSettled();
      const causeCode = observation.primary.causeCode;
      const value = typeof causeCode === 'string' && causeCode ? causeCode : observation.primary.code;
      if (typeof value === 'string' && value) code = value.slice(0, 128);
      observation.requireSettled();
    } catch (failure) { remember(failure); }
    try { attempt.persistence = { status: 'degraded', lastErrorCode: code }; }
    catch (failure) { remember(failure); }
    throw observation.wrap(Object.assign(new Error(`Runtime provenance incomplete: ${code}`, { cause: error }), {
      code: 'ERR_RUNTIME_RECEIPT_PERSIST', attemptId: next.attemptId
    }), { inspection, inspectionPresent });
  }
  Object.assign(attempt, next);
  announceRuntimeExecutionBinding(buildRoot, attempt);
  return next;
};
