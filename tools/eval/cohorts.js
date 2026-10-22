import { resolveSearchMode } from '../../src/retrieval/cli-args.js';

const FIELDS = Object.freeze({ code: ['runCode', 'code'], prose: ['runProse', 'prose'],
  'extracted-prose': ['runExtractedProse', 'extractedProse'], records: ['runRecords', 'records'] });

/** Combined responses contain independently ranked lists, not a comparable score
 * space. Explicit mode-qualified judgments make each cohort denominator known. */
export const resolveEvaluationCohorts = (rawMode, judgments = []) => {
  const selection = resolveSearchMode(rawMode);
  const modes = Object.keys(FIELDS).filter(mode => selection[FIELDS[mode][0]]);
  for (const expected of judgments) {
    if (modes.length > 1 && !expected?.mode) throw new Error('Combined-mode evaluation requires an explicit mode on every relevance judgment; use code, prose, extracted-prose or records.');
    if (expected?.mode && !modes.includes(expected.mode)) throw new Error(`Judgment mode ${expected.mode} is outside the selected evaluation cohorts.`);
  }
  return { requestMode: selection.searchMode === 'default' ? null : selection.searchMode, modes };
};
export const selectEvaluationCohort = (payload, mode) => {
  if (!Object.hasOwn(FIELDS, mode)) throw new Error(`Unsupported evaluation cohort ${mode}.`);
  const rows = payload?.[FIELDS[mode][1]];
  if (rows == null) return [];
  if (!Array.isArray(rows)) throw new Error(`Invalid ${mode} evaluation response.`);
  return rows;
};
export const judgmentsForCohort = (judgments, mode) => judgments.filter(row => !row?.mode || row.mode === mode);
