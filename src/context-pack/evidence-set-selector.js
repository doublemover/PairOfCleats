import { throwIfAborted } from '../shared/abort.js';
import { CONTEXT_EVIDENCE_ROLES } from '../contracts/context-evidence-selection.js';
import { contextEvidenceTerms, contextEvidenceJaccard } from './evidence-similarity.js';

const compare = (left, right) => left.priority - right.priority
  || (right.relevance ?? 1 / (1 + right.rank)) - (left.relevance ?? 1 / (1 + left.rank))
  || left.rank - right.rank || (left.entry.id < right.entry.id ? -1 : left.entry.id > right.entry.id ? 1 : 0);

/** Deterministic bounded controls over one immutable, source-qualified pool.
 * measure performs actual full-envelope admission. Query-specific scores and
 * annotations stay in this invocation, never on shared candidates. */
export const selectContextEvidenceSet = async ({ pool, policy, budget, measure, initial, signal }) => {
  const decisions = pool.decisions.map(row => ({ ...row, roles: row.roles.slice(),
    sourceIdentity: row.sourceIdentity ? { ...row.sourceIdentity, span: row.sourceIdentity.span.slice() } : null }));
  const decisionMap = new Map(decisions.map(row => [row.id, row]));
  const selected = [], skipped = new Set(), features = new Map(), similarities = new Map();
  const history = [initial];
  const stats = { pairwise: 0, measurements: 1 };
  let stopReason = pool.stopReason, current = initial;
  const stop = new Error('Evidence selector work bound reached.');
  const consume = () => {
    throwIfAborted(signal);
    const state = budget.consume(1);
    if (state.stop) { stopReason = state.reason; throw stop; }
  };
  const similarity = (left, right) => {
    consume();
    if (left.entry.id === right.entry.id) return features.get(left.entry.id)?.size ? 1 : 0;
    const key = left.rank < right.rank ? `${left.entry.id}:${right.entry.id}` : `${right.entry.id}:${left.entry.id}`;
    if (similarities.has(key)) return similarities.get(key);
    if (stats.pairwise >= policy.maxPairwise) { stopReason = 'maxPairwise'; throw stop; }
    stats.pairwise++;
    const a = features.get(left.entry.id), b = features.get(right.entry.id);
    const value = contextEvidenceJaccard(a, b, consume);
    similarities.set(key, value); return value;
  };
  const candidates = pool.candidates.slice().sort(compare);
  const coverage = new Map(candidates.map(candidate => [candidate.entry.id, 0]));
  try {
    if (!candidates.length || !policy.maxSelected || policy.maxMeasurements === 1 || budget.shouldStop()
      || !policy.maxWorkUnits || !policy.maxWallClockMs) {
      stopReason ||= !policy.maxSelected ? 'maxSelected' : policy.maxMeasurements === 1 ? 'maxMeasurements'
        : !policy.maxWorkUnits ? 'maxWorkUnits' : !policy.maxWallClockMs ? 'maxWallClockMs' : null;
      throw stop;
    }
    // All controls pay for the same bounded feature preparation. The metric is
    // declared lexical-prefix overlap; empty/unprepared evidence stays explicit.
    for (const candidate of candidates) {
      consume();
      const terms = contextEvidenceTerms(candidate.entry.excerpt, consume);
      features.set(candidate.entry.id, terms);
    }
    while (selected.length < policy.maxSelected) {
      consume();
      const remaining = candidates.filter(candidate => !selected.includes(candidate) && !skipped.has(candidate.entry.id));
      if (!remaining.length) break;
      const coveredRoles = new Set(selected.flatMap(candidate => candidate.entry.roles));
      let best = null, bestGain = -Infinity;
      for (const candidate of remaining) {
        consume();
        const relevance = candidate.relevance ?? 1 / (1 + candidate.rank);
        let gain = relevance;
        if (policy.algorithm === 'mmr') {
          const redundancy = selected.length ? Math.max(...selected.map(prior => similarity(candidate, prior))) : 0;
          gain = policy.lambda * relevance - (1 - policy.lambda) * redundancy;
        } else if (policy.algorithm === 'role-coverage') {
          gain = candidate.entry.roles.filter(role => !coveredRoles.has(role)).length;
        } else if (policy.algorithm === 'facility-location') {
          gain = 0;
          for (const target of candidates) gain += Math.max(0, similarity(candidate, target) - coverage.get(target.entry.id));
        }
        if (best === null || gain > bestGain || gain === bestGain && compare(candidate, best) < 0) { best = candidate; bestGain = gain; }
        if (policy.algorithm === 'top-k') break;
      }
      if (!best) break;
      if (['role-coverage', 'facility-location'].includes(policy.algorithm) && bestGain <= 0) {
        stopReason ||= 'objective-saturated'; break;
      }
      if (stats.measurements >= policy.maxMeasurements) { stopReason = 'maxMeasurements'; break; }
      consume(); stats.measurements++;
      const trial = await measure([...selected, best].map(candidate => candidate.entry));
      throwIfAborted(signal);
      const row = decisionMap.get(best.entry.id);
      row.marginalGain = bestGain;
      row.tokenDelta = Number.isSafeInteger(trial.tokens) ? trial.tokens - current.tokens : null;
      if (!trial.fits) { row.reason = trial.reason; skipped.add(best.entry.id); continue; }
      selected.push(best); current = trial; history.push(trial);
      row.status = 'selected'; row.reason = 'admitted-intact-unit';
      if (policy.algorithm === 'facility-location') for (const target of candidates) {
        coverage.set(target.entry.id, Math.max(coverage.get(target.entry.id), similarity(best, target)));
      }
    }
    if (selected.length === policy.maxSelected && selected.length < candidates.length) stopReason ||= 'maxSelected';
  } catch (error) { if (error !== stop) throw error; }
  if (budget.shouldStop()) stopReason = budget.buildTruncation('evidence-selection')?.cap || stopReason;
  for (const row of decisions) if (row.status === 'deferred' && row.reason === 'not-selected') row.reason = stopReason || 'not-admitted';
  const available = CONTEXT_EVIDENCE_ROLES.filter(role => candidates.some(candidate => candidate.entry.roles.includes(role)));
  const covered = CONTEXT_EVIDENCE_ROLES.filter(role => selected.some(candidate => candidate.entry.roles.includes(role)));
  return { selected: selected.map(candidate => candidate.entry), decisions, history, current, stopReason, stats,
    similarity: { meaning: 'lexical-prefix-jaccard', maxChars: 4096, maxTerms: 128,
      emptyIds: candidates.filter(candidate => features.get(candidate.entry.id)?.size === 0).map(candidate => candidate.entry.id),
      unavailableIds: candidates.filter(candidate => !features.has(candidate.entry.id)).map(candidate => candidate.entry.id) },
    coverage: { meaning: 'heuristic-graph-incidence', available, selected: covered,
      missing: available.filter(role => !covered.includes(role)), unknownRoleIds: decisions.filter(row => row.status !== 'omitted' && !row.roles.length).map(row => row.id) } };
};
