import { readEvaluationData, captureEvaluationArray } from '../eval/passive-evidence.js';

export const RETRIEVAL_COHORT_FIELDS = Object.freeze({ code: 'code', prose: 'prose', 'extracted-prose': 'extractedProse', records: 'records' });
const invalidResponse = message => Object.assign(new Error(message), { code: 'ERR_RETRIEVAL_RESPONSE' });

/** The same successful response/retained-hit admission supplies judged eval and
 * backend comparisons. Selected explicit emptiness is valid; absence is not. */
export const selectRetrievalCohort = (payload, mode, { invalid = invalidResponse, context = 'retrieval' } = {}) => {
  if (!Object.hasOwn(RETRIEVAL_COHORT_FIELDS, mode)) throw invalid(`Unsupported ${context} cohort ${mode}.`);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('A successful retrieval response is required.');
  const outcome = readEvaluationData(payload, 'ok', invalid);
  if (outcome.present && outcome.value !== true) throw invalid('A successful retrieval response is required.');
  const receipt = readEvaluationData(payload, 'outputBudget', invalid);
  if (receipt.present && receipt.value != null) {
    const budget = receipt.value;
    if (!budget || typeof budget !== 'object' || Array.isArray(budget)
      || typeof readEvaluationData(budget, 'truncated', invalid).value !== 'boolean'
      || readEvaluationData(budget, 'omittedHits', invalid).value !== 0) throw invalid('Retrieval output omitted hits or lacks exact hit-retention evidence.');
  }
  const selected = readEvaluationData(payload, RETRIEVAL_COHORT_FIELDS[mode], invalid);
  if (!selected.present || !Array.isArray(selected.value)) throw invalid(`Missing or invalid selected ${mode} ${context} cohort; explicit empty arrays are required for zero hits.`);
  const captured = captureEvaluationArray(selected.value, invalid);
  for (let index = 0; index < captured.length; index++) {
    if (!captured[index] || typeof captured[index] !== 'object' || Array.isArray(captured[index])) throw invalid(`Invalid selected ${mode} ${context} hit at rank ${index + 1}.`);
  }
  return captured;
};
