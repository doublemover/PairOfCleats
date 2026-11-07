import { semanticHash, canonicalSemanticJson } from '../../src/index/semantic/identity.js';
import { readEvaluationData } from './passive-evidence.js';

export const LIVE_EVALUATION_METRIC_POLICY = 'requested-output-prefix.v1;mode-qualified-cohort-macro.v3;distinct-document-one-to-one.v1';
const fail = message => Object.assign(new Error(message), { code: 'ERR_EVAL_DEPTH_POLICY' });

/** Reporting never increases the retrieval depth selected by the operator. */
export const createEvaluationDepthPlan = (requestedDepth, matchMode) => {
  if (!Number.isSafeInteger(requestedDepth) || requestedDepth < 1 || !['exact', 'substring'].includes(matchMode)) {
    throw fail('Evaluation needs a positive safe retrieval depth and an admitted matching policy.');
  }
  const definition = { schemaVersion: 1, policy: LIVE_EVALUATION_METRIC_POLICY, requestedDepth, matchMode,
    cutoffs: [...new Set([1, 3, 5, 10, requestedDepth].filter(value => value <= requestedDepth))].sort((a, b) => a - b),
    reciprocalRank: { name: 'MRR@' + requestedDepth, cutoff: requestedDepth, unobservedTail: 'censored' },
    estimand: 'judged returned output at the requested retrieval depth' };
  return Object.freeze({ ...definition, cutoffs: Object.freeze(definition.cutoffs),
    reciprocalRank: Object.freeze(definition.reciprocalRank),
    key: semanticHash('pairofcleats.live-evaluation-plan.v1', definition) });
};

export const evaluationDepthCoverage = (hits, plan) => {
  if (hits.length > plan.requestedDepth) throw Object.assign(new Error('Retrieval returned more ranks than the admitted evaluation depth.'),
    { code: 'ERR_EVAL_RESPONSE' });
  return { requestedDepth: plan.requestedDepth, observedDepth: hits.length,
    window: hits.length === plan.requestedDepth ? 'requested-prefix-returned' : 'short-response',
    exhaustion: 'unknown', unobservedTail: 'unknown' };
};

/** Legacy/unqualified reports cannot authorize a paired quality comparison. */
export const assertCompatibleEvaluationDepthPlans = (left, right) => {
  for (const plan of [left, right]) {
    if (!plan || typeof plan !== 'object') throw fail('Evaluation comparison requires both depth and metric policy receipts.');
    const depth = readEvaluationData(plan, 'requestedDepth', fail).value;
    const mode = readEvaluationData(plan, 'matchMode', fail).value;
    if (canonicalSemanticJson(plan, { maxBytes: 8192 }) !== canonicalSemanticJson(createEvaluationDepthPlan(depth, mode))) {
      throw fail('Evaluation comparison requires an intact depth and metric policy receipt on both reports.');
    }
  }
  const leftKey = readEvaluationData(left, 'key', fail).value, rightKey = readEvaluationData(right, 'key', fail).value;
  if (leftKey !== rightKey) throw fail('Evaluation metric cutoffs, retrieval depth or matching policies differ.');
  return leftKey;
};
