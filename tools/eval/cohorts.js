import { resolveSearchMode } from '../../src/retrieval/cli-args.js';
import { assertEvaluationMode, captureEvaluationJudgments } from './judgments.js';
import { readEvaluationData, captureEvaluationArray } from './passive-evidence.js';

const FIELDS = Object.freeze({ code: ['runCode', 'code'], prose: ['runProse', 'prose'],
  'extracted-prose': ['runExtractedProse', 'extractedProse'], records: ['runRecords', 'records'] });

/** Combined responses contain independently ranked lists, not a comparable score
 * space. Explicit mode-qualified judgments make each cohort denominator known. */
export const resolveEvaluationCohorts = (rawMode, judgments = []) => {
  const selection = resolveSearchMode(rawMode);
  const modes = Object.keys(FIELDS).filter(mode => selection[FIELDS[mode][0]]);
  for (const expected of captureEvaluationJudgments(judgments)) {
    if (modes.length > 1 && !Object.hasOwn(expected, 'mode')) throw new Error('Combined-mode evaluation requires an explicit mode on every relevance judgment; use code, prose, extracted-prose or records.');
    if (Object.hasOwn(expected, 'mode') && !modes.includes(expected.mode)) throw new Error(`Judgment mode ${expected.mode} is outside the selected evaluation cohorts.`);
  }
  return { requestMode: selection.searchMode === 'default' ? null : selection.searchMode, modes };
};
export const selectEvaluationCohort = (payload, mode) => {
  if (!Object.hasOwn(FIELDS, mode)) throw new Error(`Unsupported evaluation cohort ${mode}.`);
  const invalid = message => Object.assign(new Error(message), { code: 'ERR_EVAL_RESPONSE' });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalid('Evaluation requires a successful retrieval response, not a failed or missing outcome.');
  }
  const outcome = readEvaluationData(payload, 'ok', invalid);
  if (outcome.present && outcome.value !== true) throw invalid('Evaluation requires a successful retrieval response, not a failed or missing outcome.');
  const receipt = readEvaluationData(payload, 'outputBudget', invalid);
  if (receipt.present && receipt.value != null) {
    const budget = receipt.value;
    if (!budget || typeof budget !== 'object' || Array.isArray(budget)
      || typeof readEvaluationData(budget, 'truncated', invalid).value !== 'boolean'
      || readEvaluationData(budget, 'omittedHits', invalid).value !== 0) {
      throw invalid('Retrieval output omitted hits or lacks exact hit-retention evidence; judged evaluation is unavailable.');
    }
  }
  const selected = readEvaluationData(payload, FIELDS[mode][1], invalid), rows = selected.value;
  if (!selected.present || !Array.isArray(rows)) throw invalid(`Missing or invalid selected ${mode} evaluation cohort; an explicit empty array is required for zero hits.`);
  const captured = captureEvaluationArray(rows, invalid);
  for (let index = 0; index < captured.length; index++) {
    if (!captured[index] || typeof captured[index] !== 'object' || Array.isArray(captured[index])) {
      throw invalid(`Invalid selected ${mode} evaluation hit at rank ${index + 1}.`);
    }
  }
  return captured;
};
export const judgmentsForCohort = (judgments, mode) => {
  assertEvaluationMode(mode);
  return captureEvaluationJudgments(judgments).filter(row => !Object.hasOwn(row, 'mode') || row.mode === mode);
};
