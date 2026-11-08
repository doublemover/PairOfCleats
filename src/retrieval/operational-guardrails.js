import { normalizeOptionalNumber, normalizePositiveInt } from '../shared/limits.js';

export const OP_CONFIG_GUARDRAIL_CODES = Object.freeze({
  ANN_CANDIDATE_BOUNDS_INVALID: 'op_guardrail_ann_candidate_bounds_invalid',
  ANN_CANDIDATE_CAP_OUT_OF_RANGE: 'op_guardrail_ann_candidate_cap_out_of_range',
  RRF_K_INVALID: 'op_guardrail_rrf_k_invalid'
});

export const OP_RETRIEVAL_DEFAULTS = Object.freeze({
  annCandidateCap: 20000,
  annCandidateMinDocCount: 100,
  annCandidateMaxDocCount: 20000,
  queryCacheMaxEntries: 200,
  queryCacheTtlMs: 0,
  rrfK: 60,
  storageTier: 'balanced',
  queryCacheStrategy: 'disk-first',
  queryCachePrewarmMaxEntries: 128,
  queryCacheMemoryFreshMs: 1000,
  sqliteFtsTailRowCap: 3000,
  sqliteFtsTailTimeBudgetMs: 90,
  sqliteFtsTailChunkSize: 256
});

const diagnostics = new WeakMap();
/** Only errors produced by this owner may become field diagnostics. */
export const getOperationalGuardrailDiagnostic = error => diagnostics.get(error) || null;

const buildGuardrailError = (code, message) => {
  const error = new Error(`[${code}] ${message}`);
  error.guardrailCode = code;
  diagnostics.set(error, Object.freeze({ code, message: error.message }));
  return error;
};

/**
 * Reject risky retrieval knob combinations early with stable guardrail codes.
 * @param {{
 *   annCandidateCap:number,
 *   annCandidateMinDocCount:number,
 *   annCandidateMaxDocCount:number,
 *   rrfK:number
 * }} input
 */
export const validateOperationalGuardrails = ({
  annCandidateCap,
  annCandidateMinDocCount,
  annCandidateMaxDocCount,
  rrfK
}) => {
  if (annCandidateMinDocCount > annCandidateMaxDocCount) {
    throw buildGuardrailError(
      OP_CONFIG_GUARDRAIL_CODES.ANN_CANDIDATE_BOUNDS_INVALID,
      'retrieval.annCandidateMinDocCount cannot exceed retrieval.annCandidateMaxDocCount.'
    );
  }
  if (annCandidateCap < annCandidateMinDocCount || annCandidateCap > annCandidateMaxDocCount) {
    throw buildGuardrailError(
      OP_CONFIG_GUARDRAIL_CODES.ANN_CANDIDATE_CAP_OUT_OF_RANGE,
      'retrieval.annCandidateCap must stay within [annCandidateMinDocCount, annCandidateMaxDocCount].'
    );
  }
  if (!Number.isFinite(rrfK) || rrfK <= 0) {
    throw buildGuardrailError(
      OP_CONFIG_GUARDRAIL_CODES.RRF_K_INVALID,
      'search.rrf.k must be a positive number.'
    );
  }
};

/** Resolve the same effective values for search and configuration editing.
 * Authority filtering and trusted source merging belong to loadUserConfig.
 * No backend, provider, artifact or native runtime is initialized here.
 */
export const resolveOperationalGuardrails = ({ userConfig = {}, policy = null } = {}) => {
  const retrieval = userConfig?.retrieval || {};
  const values = {
    annCandidateCap: normalizePositiveInt(retrieval.annCandidateCap, OP_RETRIEVAL_DEFAULTS.annCandidateCap),
    annCandidateMinDocCount: normalizePositiveInt(retrieval.annCandidateMinDocCount, OP_RETRIEVAL_DEFAULTS.annCandidateMinDocCount),
    annCandidateMaxDocCount: normalizePositiveInt(retrieval.annCandidateMaxDocCount, OP_RETRIEVAL_DEFAULTS.annCandidateMaxDocCount),
    rrfK: normalizeOptionalNumber(userConfig?.search?.rrf?.k)
      ?? normalizeOptionalNumber(policy?.retrieval?.rrf?.k) ?? OP_RETRIEVAL_DEFAULTS.rrfK
  };
  validateOperationalGuardrails(values);
  return values;
};
