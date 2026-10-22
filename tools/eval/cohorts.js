import { resolveSearchMode } from '../../src/retrieval/cli-args.js';
import { assertEvaluationMode, captureEvaluationJudgments } from './judgments.js';

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
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || (Object.hasOwn(payload, 'ok') && payload.ok !== true)) {
    throw invalid('Evaluation requires a successful retrieval response, not a failed or missing outcome.');
  }
  if (payload.outputBudget != null) {
    const budget = payload.outputBudget;
    if (!budget || typeof budget !== 'object' || Array.isArray(budget)
      || typeof budget.truncated !== 'boolean' || !Number.isSafeInteger(budget.omittedHits) || budget.omittedHits !== 0) {
      throw invalid('Retrieval output omitted hits or lacks exact hit-retention evidence; judged evaluation is unavailable.');
    }
  }
  const field = FIELDS[mode][1], rows = payload[field];
  if (!Object.hasOwn(payload, field) || !Array.isArray(rows)) throw invalid(`Missing or invalid selected ${mode} evaluation cohort; an explicit empty array is required for zero hits.`);
  for (let index = 0; index < rows.length; index++) {
    if (!Object.hasOwn(rows, index) || !rows[index] || typeof rows[index] !== 'object' || Array.isArray(rows[index])) {
      throw invalid(`Invalid selected ${mode} evaluation hit at rank ${index + 1}.`);
    }
  }
  return rows;
};
export const judgmentsForCohort = (judgments, mode) => {
  assertEvaluationMode(mode);
  return captureEvaluationJudgments(judgments).filter(row => !Object.hasOwn(row, 'mode') || row.mode === mode);
};
