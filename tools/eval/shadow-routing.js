import { createHash } from 'node:crypto';
import { shadowQueryRoute, simulateShadowAllocation } from '../../src/retrieval/evaluation/shadow-routing.js';

/** Optional saved inputs extend the existing evaluation report. They perform no
 * new repository search and cannot feed live relevance/routing aggregates.
 */
export const evaluateDatasetShadowRouting = ({ cases, signal = null } = {}) => {
  const reports = []; let truncated = false;
  for (const entry of cases) {
    if (entry?.shadowRouting == null) continue;
    if (reports.length >= 64) { truncated = true; break; }
    try {
      const input = entry.shadowRouting;
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Dataset shadow routing requires an explicit saved-input object.');
      const query = String(entry.query || '').trim();
      const classification = shadowQueryRoute({ query, queryAst: input.queryAst ?? null, requestKind: input.requestKind ?? 'text', signal });
      let allocation = null;
      if (input.snapshot != null) {
        if (input.snapshot.queryTextDigest !== createHash('sha256').update(query).digest('hex')) throw new Error('Shadow candidate snapshot query text does not match this evaluation case.');
        allocation = classification.complete ? simulateShadowAllocation({ ...input, queryClass: classification.label, signal }) : null;
      }
      reports.push({ classification, allocation });
    } catch {
      reports.push({ classification: { complete: false, authoritative: false, reason: 'saved-input-admission-failed' }, allocation: null });
    }
  }
  return reports.length ? { schemaVersion: 1, kind: 'saved-shadow-routing', authoritative: false,
    currentSearchEvidence: false, complete: !truncated && reports.every(row => row.classification.complete && (!row.allocation || row.allocation.complete)),
    truncated, aggregation: 'separate-from-live-judged-metrics', reports } : null;
};
