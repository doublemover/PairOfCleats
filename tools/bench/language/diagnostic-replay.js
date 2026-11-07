import crypto from 'node:crypto';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION, DIAGNOSTIC_COST_KEYS } from './diagnostic-contract.js';

export const DIAGNOSTIC_REPLAY_MAX_IDENTITIES = 100000;
export { DIAGNOSTIC_COST_KEYS };
export const observedDiagnosticCost = (value, { integer = false } = {}) => typeof value === 'number' && Number.isFinite(value)
  && value >= 0 && (!integer || Number.isSafeInteger(value)) ? value : null;
const digest = value => crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);

/** Fingerprint presence is distinct from occurrence and transport identity.
 * Legacy exact-copy matching is explicitly unqualified across process restarts;
 * it cannot silently claim the execution identity supplied by new producers. */
export const createDiagnosticReplay = ({ maxIdentities = DIAGNOSTIC_REPLAY_MAX_IDENTITIES } = {}) => {
  if (!Number.isSafeInteger(maxIdentities) || maxIdentities < 1 || maxIdentities > DIAGNOSTIC_REPLAY_MAX_IDENTITIES) throw new TypeError('Private replay budget may only lower the fixed bound.');
  const occurrences = new Map(), presences = new Set();
  const costs = Object.fromEntries(DIAGNOSTIC_COST_KEYS.map(key => [key, { observed: 0, unknown: 0, observedTotal: 0 }]));
  let duplicateCopies = 0, mirrorCopies = 0, legacyOccurrences = 0, qualifiedOccurrences = 0, rejected = 0, conflictingCopies = 0, invalidSemantics = 0;
  return {
    observe(event, { scope, filePath, masterFile }) {
      const repositoryKnown = Boolean(event.label) || !masterFile;
      const repositoryScope = event.label || (masterFile ? `unknown-source:${filePath}` : scope);
      const legacyVersion = event.schemaVersion == null || [1, 2].includes(event.schemaVersion);
      const semanticsValid = legacyVersion || event.schemaVersion === BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION && event.costSemantics === 'occurrence-delta';
      const qualified = event.schemaVersion === BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION && semanticsValid && uuid(event.executionId)
        && Number.isSafeInteger(event.occurrence) && event.occurrence > 0;
      const projection = { repositoryScope, eventId: event.eventId, occurrence: event.occurrence ?? null,
        ts: event.ts ?? null, eventType: event.eventType, source: event.source ?? null,
        message: event.message, severity: event.severity,
        costs: Object.fromEntries(DIAGNOSTIC_COST_KEYS.map(key => [key, semanticsValid ? observedDiagnosticCost(event[key], { integer: key !== 'timeCostMs' }) : null])) };
      const content = digest(projection);
      const key = qualified ? digest([event.executionId, repositoryScope, event.eventId, event.occurrence]) : content;
      const previous = occurrences.get(key);
      if (previous) {
        duplicateCopies++;
        if (previous.filePath !== filePath) mirrorCopies++;
        if (previous.content !== content) conflictingCopies++;
        return { newPresence: false, newOccurrence: false, repositoryScope, repositoryKnown };
      }
      if (occurrences.size >= maxIdentities) { rejected++; return { newPresence: false, newOccurrence: false, repositoryScope, repositoryKnown }; }
      occurrences.set(key, { filePath, content });
      if (!semanticsValid) invalidSemantics++;
      if (qualified) qualifiedOccurrences++; else legacyOccurrences++;
      const presenceKey = digest([repositoryScope, event.eventId]);
      const newPresence = !presences.has(presenceKey);
      presences.add(presenceKey);
      for (const field of DIAGNOSTIC_COST_KEYS) {
        const value = projection.costs[field], counter = costs[field];
        if (value === null) counter.unknown++;
        else { counter.observed++; counter.observedTotal += value; }
      }
      return { newPresence, newOccurrence: true, repositoryScope, repositoryKnown };
    },
    summary() {
      const overflow = Object.entries(costs).some(([key, value]) => value.observed > 0
        && observedDiagnosticCost(value.observedTotal, { integer: key !== 'timeCostMs' }) === null);
      const incomplete = rejected > 0 || conflictingCopies > 0 || invalidSemantics > 0 || overflow;
      return { occurrenceCount: occurrences.size, presenceCount: presences.size,
        duplicateEventCount: duplicateCopies, mirrorDuplicateCount: mirrorCopies,
        repeatedFingerprintOccurrenceCount: Math.max(0, occurrences.size - presences.size), incomplete,
        identityCoverage: { qualifiedOccurrences, legacyOccurrences, conflictingCopies, invalidSemantics, rejected,
          maxIdentities, state: incomplete ? 'incomplete' : legacyOccurrences ? 'legacy-unqualified' : qualifiedOccurrences ? 'qualified' : 'unobserved' },
        costScope: 'sum-observed-occurrence-deltas-not-wall-time',
        cost: Object.fromEntries(Object.entries(costs).map(([key, value]) => [key,
          value.observed ? observedDiagnosticCost(value.observedTotal, { integer: key !== 'timeCostMs' }) : null])),
        costCoverage: Object.fromEntries(Object.entries(costs).map(([key, value]) => [key, { ...value,
          observedTotal: value.observed ? observedDiagnosticCost(value.observedTotal, { integer: key !== 'timeCostMs' }) : null,
          state: incomplete || !Number.isFinite(value.observedTotal) ? 'incomplete' : !value.observed ? 'unknown' : value.unknown ? 'partial' : 'complete' }])) };
    }
  };
};
