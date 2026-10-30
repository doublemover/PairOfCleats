import { resolveEvaluationCohorts } from '../../eval/cohorts.js';
import { selectRetrievalCohort } from '../../shared/retrieval-cohort-admission.js';

/** Hit-presence is not relevance. Every actually requested independently ranked
 * cohort contributes its count; a missing cohort is unavailable, never empty. */
export const captureBenchmarkQueryResults = (payload, requestMode) => {
  const { modes } = resolveEvaluationCohorts(requestMode);
  const countsByMode = Object.fromEntries(modes.map(mode => [mode, selectRetrievalCohort(payload, mode).length]));
  const totalHits = Object.values(countsByMode).reduce((sum, count) => sum + count, 0);
  return { schemaVersion: 1, modes, countsByMode, totalHits, nonempty: totalHits > 0,
    scope: 'selected-result-cohort-hit-presence' };
};
