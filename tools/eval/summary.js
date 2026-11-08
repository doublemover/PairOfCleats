/** Two-level macro: equal judged cohorts within each case, then equal judged
 * cases. Missing judgments never become zero-quality observations. */
export const buildEvaluationSummary = (results, evaluationPlan) => {
  const tier = (key, judgmentKey) => {
    const eligible = results.filter(row => row.cohorts.some(cohort => cohort.totals[judgmentKey] > 0));
    const observed = results.filter(row => row[key] !== null && row[key] !== undefined);
    const cohorts = results.flatMap(row => row.cohorts);
    const counts = { eligibleCases: eligible.length, observedCases: observed.length,
      unjudgedCases: results.length - eligible.length, eligibleCohorts: cohorts.filter(row => row.totals[judgmentKey] > 0).length,
      observedCohorts: cohorts.filter(row => row[key] !== null && row[key] !== undefined).length,
      unjudgedCohorts: cohorts.filter(row => row.totals[judgmentKey] === 0).length };
    const average = select => observed.length ? observed.reduce((sum, row) => sum + select(row[key]), 0) / observed.length : null;
    const map = field => Object.fromEntries(evaluationPlan.cutoffs.map(k => [k, average(row => row[field][k])]));
    return { availability: observed.length ? 'observed' : 'unavailable-no-judgments', ...counts,
      metrics: { recallAtK: map('recallAtK'), ndcgAtK: map('ndcgAtK'), mrr: average(row => row.mrr) },
      metricCoverage: { mrr: { ...counts, cutoff: evaluationPlan.requestedDepth },
        recallAtK: Object.fromEntries(evaluationPlan.cutoffs.map(k => [k, counts])),
        ndcgAtK: Object.fromEntries(evaluationPlan.cutoffs.map(k => [k, counts])) } };
  };
  const silver = tier('metrics', 'relevant'), gold = tier('goldMetrics', 'gold');
  return { evaluationPlan, cases: results.length, ...silver.metrics,
    judgmentCoverage: { schemaVersion: 1, weighting: 'equal-judged-cohorts-within-case;equal-judged-cases',
      silver, gold } };
};
