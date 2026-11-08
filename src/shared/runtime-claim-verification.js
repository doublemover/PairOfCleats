import { performance } from 'node:perf_hooks';
import { addStorageFailureContext } from './storage/operation-error.js';
import { RUNTIME_CLAIM_VERIFICATION_LIMITS } from '../contracts/runtime-claim-verification.js';
const receipts = new WeakMap();
export const getRuntimeClaimVerification = error => receipts.get(error) || null;

/** Per-operation physical admission; response limits never masquerade as
 * corrupt evidence. Overrides can only lower bounds for internal controls. */
export const createRuntimeClaimVerification = (overrides = {}, { maxMs = 1000 } = {}) => {
  if (!Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000) throw new TypeError('Invalid claim verification deadline.');
  const limits = { ...RUNTIME_CLAIM_VERIFICATION_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(RUNTIME_CLAIM_VERIFICATION_LIMITS, key) || !Number.isSafeInteger(value)
      || value < 1 || value > RUNTIME_CLAIM_VERIFICATION_LIMITS[key]) throw new TypeError('Invalid claim verification allowance.');
  }
  const started = performance.now();
  const metrics = { familyOpens: 0, citationRows: 0, hydratedBytes: 0, rawVerificationBytes: 0,
    verificationBytes: 0, claimVerificationBytes: 0, claimRowBytes: 0, responseBytes: 0 };
  let refusal = null, citationsVerified = false;
  const snapshot = () => ({ schemaVersion: 1, scope: 'all-family-citations', citationsVerified,
    limits: { ...limits, maxMs }, cost: { familyOpens: metrics.familyOpens, citationRows: metrics.citationRows,
      hydratedBytes: metrics.hydratedBytes, rawVerificationBytes: metrics.rawVerificationBytes,
      familyVerificationBytes: metrics.verificationBytes - metrics.hydratedBytes,
      claimVerificationBytes: metrics.claimVerificationBytes, claimRowBytes: metrics.claimRowBytes,
      responseBytes: metrics.responseBytes, elapsedMs: Math.max(0, Math.ceil(performance.now() - started)) },
    refusal: refusal && { ...refusal } });
  const refuse = (basis, consumed, required, limit) => {
    refusal = { basis, consumed, required, limit };
    throw Object.assign(new Error('Saved claim ' + basis + ' allowance exceeded.'), { code: 'ERR_RUNTIME_QUERY_BUDGET' });
  };
  const claimMetrics = { get verificationBytes() { return metrics.claimVerificationBytes; },
    set verificationBytes(value) { metrics.claimVerificationBytes = value; } };
  return { metrics, claimMetrics, limits, snapshot, refuse,
    admit(basis, required) {
      const key = { familyOpens: 'maxFamilies', citationRows: 'maxCitationRows', hydratedBytes: 'maxHydratedBytes',
        rawVerificationBytes: 'maxRawVerificationBytes' }[basis];
      if (!key || !Number.isSafeInteger(required) || required < 0) throw new TypeError('Invalid physical claim admission.');
      if (required > limits[key] - metrics[basis]) refuse(basis, metrics[basis], required, limits[key]);
    },
    markVerified() { citationsVerified = true; },
    retainFailure(error) {
      if (error?.code === 'ERR_RUNTIME_QUERY_BUDGET' && !refusal) {
        refusal = { basis: 'elapsedMs', consumed: Math.max(0, Math.ceil(performance.now() - started)), required: 0, limit: maxMs };
      }
      const receipt = snapshot();
      Object.freeze(receipt.limits); Object.freeze(receipt.cost); if (receipt.refusal) Object.freeze(receipt.refusal);
      Object.freeze(receipt);
      const failure = addStorageFailureContext(error, { runtimeClaimVerification: receipt });
      receipts.set(failure, receipt); return failure;
    }
  };
};
