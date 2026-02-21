import { stableStringify } from './stable-json.js';

export const NATIVE_ACCEL_CONTRACT_VERSION = '1.0.0';
export const NATIVE_ACCEL_RUNTIME_KIND = 'js';
export const NATIVE_ACCEL_ABI_VERSION = 1;

export const NATIVE_ACCEL_ERROR_CODES = Object.freeze({
  DISABLED_NO_GO: 'NATIVE_ACCEL_DISABLED_NO_GO',
  ABI_MISMATCH: 'NATIVE_ACCEL_ABI_MISMATCH'
});

export const NATIVE_ACCEL_DECISION = Object.freeze({
  version: NATIVE_ACCEL_CONTRACT_VERSION,
  decision: 'no-go',
  runtimeKind: NATIVE_ACCEL_RUNTIME_KIND,
  abiVersion: NATIVE_ACCEL_ABI_VERSION,
  featureBits: 0,
  fallbackRuntimeKind: NATIVE_ACCEL_RUNTIME_KIND,
  decidedAt: '2026-02-21T00:00:00Z',
  reason: 'Native acceleration does not currently justify added operational and correctness risk.'
});

const normalizeInteger = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.floor(numeric);
};

const compareSerializable = (left, right) => stableStringify(left) === stableStringify(right);

export const getNativeAccelCapabilities = () => ({
  version: NATIVE_ACCEL_CONTRACT_VERSION,
  decision: NATIVE_ACCEL_DECISION.decision,
  enabled: false,
  runtimeKind: NATIVE_ACCEL_RUNTIME_KIND,
  fallbackRuntimeKind: NATIVE_ACCEL_RUNTIME_KIND,
  abiVersion: NATIVE_ACCEL_ABI_VERSION,
  featureBits: 0
});

/**
 * Negotiate runtime capabilities at the ABI boundary. Even though the no-go decision
 * keeps native disabled, we keep this deterministic negotiation response so callers
 * can rely on one stable failure taxonomy and fallback surface.
 *
 * @param {{abiVersion?:number,runtimeKind?:string,featureBits?:number}} [request]
 * @returns {{ok:boolean,code:string,version:string,runtimeKind:string,fallbackRuntimeKind:string,abiVersion:number,featureBits:number,decision:string}}
 */
export const negotiateNativeRuntime = (request = {}) => {
  const abiVersion = normalizeInteger(request.abiVersion, NATIVE_ACCEL_ABI_VERSION);
  const featureBits = Math.max(0, normalizeInteger(request.featureBits, 0));
  const runtimeKind = String(request.runtimeKind || 'native').trim().toLowerCase();
  if (abiVersion !== NATIVE_ACCEL_ABI_VERSION) {
    return {
      ok: false,
      code: NATIVE_ACCEL_ERROR_CODES.ABI_MISMATCH,
      version: NATIVE_ACCEL_CONTRACT_VERSION,
      decision: NATIVE_ACCEL_DECISION.decision,
      runtimeKind,
      fallbackRuntimeKind: NATIVE_ACCEL_RUNTIME_KIND,
      abiVersion,
      expectedAbiVersion: NATIVE_ACCEL_ABI_VERSION,
      featureBits,
      expectedFeatureBits: 0
    };
  }
  return {
    ok: false,
    code: NATIVE_ACCEL_ERROR_CODES.DISABLED_NO_GO,
    version: NATIVE_ACCEL_CONTRACT_VERSION,
    decision: NATIVE_ACCEL_DECISION.decision,
    runtimeKind,
    fallbackRuntimeKind: NATIVE_ACCEL_RUNTIME_KIND,
    abiVersion,
    featureBits
  };
};

export const resolveNativeFallback = (reasonCode = NATIVE_ACCEL_ERROR_CODES.DISABLED_NO_GO) => ({
  ok: true,
  runtimeKind: NATIVE_ACCEL_RUNTIME_KIND,
  deterministic: true,
  reasonCode
});

/**
 * Build a deterministic parity report for feasibility review artifacts.
 *
 * @param {{baseline?:unknown,candidate?:unknown,label?:string}} [input]
 * @returns {{version:string,decision:string,label:string,equivalent:boolean,hasCandidate:boolean,fallbackRuntimeKind:string,mismatchCount:number,mismatches:Array<object>}}
 */
export const runNativeFeasibilityParityHarness = (input = {}) => {
  const baseline = input.baseline ?? null;
  const candidateProvided = Object.prototype.hasOwnProperty.call(input, 'candidate');
  const candidate = candidateProvided ? input.candidate : null;
  const equivalent = candidateProvided ? compareSerializable(baseline, candidate) : true;
  const mismatches = [];
  if (candidateProvided && !equivalent) {
    mismatches.push({
      path: '$',
      reason: 'stable-json-mismatch',
      baseline,
      candidate
    });
  }
  return {
    version: NATIVE_ACCEL_CONTRACT_VERSION,
    decision: NATIVE_ACCEL_DECISION.decision,
    label: String(input.label || 'native-feasibility'),
    equivalent,
    hasCandidate: candidateProvided,
    fallbackRuntimeKind: NATIVE_ACCEL_RUNTIME_KIND,
    mismatchCount: mismatches.length,
    mismatches
  };
};
