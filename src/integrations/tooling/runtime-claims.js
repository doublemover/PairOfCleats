import { assertRuntimeClaims } from '../../contracts/validators/runtime-claims.js';
import { compareRuntimeCaptures } from '../../index/semantic/runtime/compare.js';
import { queryRuntimeDerivedClaims } from '../../index/semantic/runtime/claims.js';
import { resolveRuntimeEvidenceDestination } from './runtime-evidence.js';
import { throwIfAborted } from '../../shared/abort.js';
const run = async (kind, runner, payload, { signal = null, userConfig = null } = {}) => {
  assertRuntimeClaims(kind, payload); throwIfAborted(signal);
  const destination = await resolveRuntimeEvidenceDestination({ ...payload, userConfig });
  return runner({ destination, request: payload.request, signal });
};
export const runRuntimeCaptureComparison = (payload, options) => run('compareService', compareRuntimeCaptures, payload, options);
export const runRuntimeDerivedClaimLookup = (payload, options) => run('claimsService', queryRuntimeDerivedClaims, payload, options);
