import { updateBuildState } from '../build-state.js';
import { patchRuntimeAttempt } from '../../../shared/runtime-envelope/receipt.js';
import { assertRuntimeAttempt } from '../../../contracts/validators/runtime-receipt.js';
import { announceRuntimeExecutionBinding } from '../../../shared/runtime-envelope/execution-binding.js';

/** Critical provenance uses the existing required durability and lock owner. */
export const persistRuntimeAttempt = async (buildRoot, attempt, patch = {}, { write = updateBuildState } = {}) => {
  if (!buildRoot) throw Object.assign(new Error('Runtime receipt requires a selected build root.'), { code: 'ERR_RUNTIME_RECEIPT_ROOT' });
  const next = patchRuntimeAttempt(attempt, {
    ...patch, persistence: { status: 'durable', lastErrorCode: null }
  });
  assertRuntimeAttempt(next);
  try {
    await write(buildRoot, { runtime: { schemaVersion: 1, latestAttemptId: next.attemptId, attempts: [next] } });
  } catch (error) {
    attempt.persistence = { status: 'degraded', lastErrorCode: String(error?.causeCode || error?.code || 'UNKNOWN') };
    throw Object.assign(new Error(`Runtime provenance incomplete: ${attempt.persistence.lastErrorCode}`, { cause: error }), { code: 'ERR_RUNTIME_RECEIPT_PERSIST', attemptId: attempt.attemptId });
  }
  Object.assign(attempt, next);
  announceRuntimeExecutionBinding(buildRoot, attempt);
  return next;
};
