import { inspectRetainedChangeEpisode } from '../../index/scm/change-episodes/retained.js';
import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { evaluateSupportJoin } from './support-join.js';
import { enforceContextPackResponseBudget } from '../response-budget.js';

/** Historical source comparison and current predicate checks remain three-world evidence. */
export const projectPrecedentApplicability = ({ currentWorld, conditions = [], observations = [], invalidated = [], ...inspection }) => {
  if (!currentWorld || !Array.isArray(conditions) || conditions.length > 64 || !Array.isArray(observations)
    || observations.length > 4096 || !Array.isArray(invalidated) || invalidated.length > 4096) {
    throw new TypeError('Bounded admitted current applicability evidence required.');
  }
  const comparison = inspectRetainedChangeEpisode(inspection);
  const ids = new Set();
  const checks = conditions.map(requirement => {
    if (ids.has(requirement?.id) || canonicalSemanticJson(requirement?.worldRef) !== canonicalSemanticJson(currentWorld)) {
      throw new TypeError('Unique current-world applicability conditions required.');
    }
    ids.add(requirement.id);
    return evaluateSupportJoin({ requirement, observations, invalidated });
  });
  const conflicted = checks.some(check => check.status === 'conflicted');
  const applicability = !checks.length ? 'historicalOnly' : conflicted ? 'unknown'
    : checks.some(check => check.status === 'contradicted') ? 'contradicted'
      : checks.every(check => check.status === 'supported') ? 'conditionsSupported' : 'unknown';
  const payload = { comparison, currentWorld: structuredClone(currentWorld), applicability, checks,
    conditionConflict: conflicted, proofScope: 'supplied-named-current-predicates-only',
    behavioralTransfer: 'not-established', actionAuthority: 'none' };
  enforceContextPackResponseBudget(payload, { measure: value => Buffer.byteLength(JSON.stringify(value) + '\n') });
  return payload;
};
