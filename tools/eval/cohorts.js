import { resolveSearchMode } from '../../src/retrieval/cli-args.js';
import { assertEvaluationMode, captureEvaluationJudgments } from './judgments.js';
import { selectRetrievalCohort } from '../shared/retrieval-cohort-admission.js';

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
export const selectEvaluationCohort = (payload, mode) => selectRetrievalCohort(payload, mode, {
  context: 'evaluation', invalid: message => Object.assign(new Error(message), { code: 'ERR_EVAL_RESPONSE' })
});
export const judgmentsForCohort = (judgments, mode) => {
  assertEvaluationMode(mode);
  return captureEvaluationJudgments(judgments).filter(row => !Object.hasOwn(row, 'mode') || row.mode === mode);
};
