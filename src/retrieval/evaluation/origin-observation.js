import { performance } from 'node:perf_hooks';
import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { throwIfAborted } from '../../shared/abort.js';
import { ORIGIN_OBSERVATION_SCHEMA } from '../../contracts/schemas/origin-observation.js';
import { assertOriginObservation } from '../../contracts/validators/origin-observation.js';
import { evaluateTaskSpanTrace } from './task-span-trace.js';

const owned = new WeakMap();
const key = value => canonicalSemanticJson(value, { maxBytes: 4 * 1024 * 1024 });
const hash = (kind, value) => semanticHash('origin-observation.' + kind + '.v1', value, { maxBytes: 4 * 1024 * 1024 });
const fail = message => Object.assign(new Error(message), { code: 'ERR_ORIGIN_OBSERVATION_CONTRACT' });
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};
const ordered = values => [...values].sort();
const stages = ['retrieved', 'explored', 'delivered', 'used'];

/** Cheap origin-collapse baseline over explicitly supplied lineage. It reuses
 * #1131's stage/source admission and never infers independence from equal text,
 * multiple paths, citations, reported parents or an acyclic JSON graph.
 */
export const evaluateOriginObservations = async (input, { signal = null, maxMs = 250, maxOutputBytes = 131072 } = {}) => {
  const began = performance.now(); throwIfAborted(signal);
  if (!Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 250 || !Number.isSafeInteger(maxOutputBytes)
    || maxOutputBytes < 1024 || maxOutputBytes > 131072) throw new TypeError('Invalid origin observation work/output allowance.');
  input = captureSemanticRequest(input, ORIGIN_OBSERVATION_SCHEMA); assertOriginObservation(input); key(input);
  const partial = reason => Object.freeze({ schemaVersion: 1, kind: 'origin-observation-evaluation', complete: false, reason,
    stageOrigins: null, decision: null, causalStatus: 'observational-only' });
  const stopped = () => performance.now() - began >= maxMs;
  if (stopped()) return partial('deadline');
  const origins = new Map(), bindings = new Map(), sourceKeys = new Set(input.trace.sources.map(row => row.key));
  for (const origin of input.origins) {
    if (origins.has(origin.id) || origin.independence !== 'unknown' && !origin.dependenceGroupId
      || origin.independence === 'declared-independent-with-assumptions' && !origin.assumptionIds.length) throw fail('Origin identities, dependence groups and declared independence assumptions are incomplete.');
    origins.set(origin.id, origin);
  }
  const independentGroups = new Map();
  for (const origin of origins.values()) if (origin.independence === 'declared-independent-with-assumptions') {
    if (independentGroups.has(origin.dependenceGroupId)) throw fail('Distinct declared-independent origins cannot share the same dependence group.');
    independentGroups.set(origin.dependenceGroupId, origin.id);
  }
  for (const binding of input.sourceBindings) {
    if (!sourceKeys.has(binding.sourceKey) || bindings.has(binding.sourceKey) || binding.originIds.some(id => !origins.has(id))) throw fail('Lineage binding must name one existing source and declared origin identities.');
    bindings.set(binding.sourceKey, binding);
  }
  const remainingMs = Math.floor(maxMs - (performance.now() - began)); if (remainingMs < 1) return partial('deadline');
  const trace = await evaluateTaskSpanTrace(input.trace, { signal, limits: { maxMs: remainingMs } });
  throwIfAborted(signal);
  if (!trace.complete) return partial('task-trace-' + trace.reason);
  const events = new Map(input.trace.events.map(event => [event.id, event])), accepted = new Set(trace.events.filter(event => event.accepted).map(event => event.id));
  const edges = [], seenEdges = new Set();
  for (const edge of input.edges) {
    throwIfAborted(signal); if (stopped()) return partial('deadline');
    const from = events.get(edge.fromEventId), to = events.get(edge.toEventId);
    if (seenEdges.has(edge.id) || edge.runKey !== input.trace.identity.runKey || !from || !to) throw fail('Edge identity or original run/event reference differs.');
    seenEdges.add(edge.id);
    if (['observed-transfer', 'reported-parent'].includes(edge.kind)) {
      if (from.sequence >= to.sequence) throw fail('Reported transfers/parents must respect original event order; cyclic/backward derivations are invalid.');
    }
    const known = accepted.has(from.id) && accepted.has(to.id);
    if (edge.kind === 'observed-transfer' && known && (from.span.sourceKey !== to.span.sourceKey
      || from.span.generation !== to.span.generation || from.span.start > to.span.start || from.span.end < to.span.end)) throw fail('Transfer span is not contained in the declared original source span.');
    edges.push({ id: edge.id, kind: edge.kind, admittedEventMetadata: known,
      meaning: edge.kind === 'hypothesis' ? 'proposed-only' : edge.kind === 'citation' ? 'citation-not-observed-transfer'
        : edge.kind === 'reported-parent' ? 'reported-parent-not-causal-proof' : 'caller-reported-transfer-not-independently-observed' });
  }
  const stageOrigins = {}, state = new Map();
  for (const stage of stages) {
    const ids = new Set(), sources = new Set(), groups = new Set(), declaredIndependent = new Set(), unknownIndependence = new Set();
    let incidences = 0, unknownLineageEvents = 0, acceptedEvents = 0;
    for (const event of input.trace.events) {
      if (event.stage !== stage || !accepted.has(event.id)) continue;
      throwIfAborted(signal); if (stopped()) return partial('deadline');
      acceptedEvents++; sources.add(event.span.sourceKey);
      const binding = bindings.get(event.span.sourceKey);
      if (!binding) { unknownLineageEvents++; continue; }
      for (const id of binding.originIds) {
        incidences++; ids.add(id); const origin = origins.get(id);
        if (origin.dependenceGroupId) groups.add(origin.dependenceGroupId);
        if (origin.independence === 'declared-independent-with-assumptions') declaredIndependent.add(origin.dependenceGroupId);
        if (origin.independence === 'unknown') unknownIndependence.add(id);
      }
    }
    stageOrigins[stage] = { observationCoverage: trace.runComplete && trace.stages[stage].complete && !unknownLineageEvents
      && !trace.stages[stage].rejectedOrUnknownEvents ? 'complete-in-supplied-trace' : 'partial-or-unknown',
    acceptedEvents, observedSources: sources.size, distinctOriginIds: ids.size, knownDependenceGroups: groups.size,
    declaredIndependentGroups: declaredIndependent.size, unknownIndependenceOrigins: unknownIndependence.size,
    originEventIncidences: incidences, repeatedOriginIncidences: incidences - ids.size, unknownLineageEvents,
    rejectedOrUnknownEvents: trace.stages[stage].rejectedOrUnknownEvents,
    originCountMeaning: 'unique-supplied-identities; not-independent-probability-mass' };
    state.set(stage, ordered(ids));
  }
  const result = { schemaVersion: 1, kind: 'origin-observation-evaluation', complete: true,
    receiptId: hash('receipt', { traceKey: trace.traceKey, origins: input.origins, sourceBindings: input.sourceBindings, edges: input.edges }),
    traceKey: trace.traceKey, identity: trace.identity, judgmentPolicyKey: trace.judgmentPolicyKey, runComplete: trace.runComplete,
    stageOrigins, edgeSummary: Object.fromEntries(['observed-transfer', 'reported-parent', 'citation', 'hypothesis'].map(kind =>
      [kind, { supplied: edges.filter(edge => edge.kind === kind).length, withAdmittedEventMetadata: edges.filter(edge => edge.kind === kind && edge.admittedEventMetadata).length }])),
    inputAuthority: 'caller-pinned-origin-and-telemetry-metadata', sourceTruth: 'not-independently-revalidated', independence: 'declared-assumptions-not-certified',
    causalStatus: 'observational-only', decision: null, work: { taskTrace: trace.work, elapsedMs: performance.now() - began,
      sources: bindings.size, edges: edges.length, originRecords: origins.size } };
  if (Buffer.byteLength(JSON.stringify(result)) + 1 > maxOutputBytes) return partial('output-bytes');
  throwIfAborted(signal); if (stopped()) return partial('deadline'); immutable(result);
  owned.set(result, { origins: input.origins, originsByStage: state }); return result;
};

/** Pair identity excludes actual run identity but pins task/source generation
 * and judgment policy. Repeated paths and independent-origin coverage remain
 * separate measures, with unknown coverage producing no full-population delta.
 */
export const compareOriginObservations = (baseline, treatment) => {
  const before = owned.get(baseline), after = owned.get(treatment);
  if (!before || !after) throw fail('Original completed origin evaluations required.');
  const identity = result => { const { runKey: _run, inputKey: _input, ...rest } = result.identity; return { ...rest, judgmentPolicyKey: result.judgmentPolicyKey }; };
  if (key(identity(baseline)) !== key(identity(treatment))) throw fail('Paired origin traces differ in task, source generation, query, family or judgment policy.');
  const previousOrigins = new Map(before.origins.map(origin => [origin.id, origin]));
  if (after.origins.some(origin => previousOrigins.has(origin.id) && key(previousOrigins.get(origin.id)) !== key(origin))) throw fail('A shared origin changed dependence/assumption identity within the pair.');
  const comparisons = Object.fromEntries(stages.map(stage => {
    const left = baseline.stageOrigins[stage], right = treatment.stageOrigins[stage];
    const complete = left.observationCoverage === 'complete-in-supplied-trace' && right.observationCoverage === 'complete-in-supplied-trace';
    return [stage, { comparableCoverage: complete, sameObservedOrigins: complete ? key(before.originsByStage.get(stage)) === key(after.originsByStage.get(stage)) : null,
      distinctOriginDelta: complete ? right.distinctOriginIds - left.distinctOriginIds : null,
      repeatedIncidenceDelta: complete ? right.repeatedOriginIncidences - left.repeatedOriginIncidences : null,
      declaredIndependentGroupDelta: complete ? right.declaredIndependentGroups - left.declaredIndependentGroups : null }];
  }));
  return immutable({ schemaVersion: 1, kind: 'paired-origin-observation-comparison', baselineReceiptId: baseline.receiptId,
    treatmentReceiptId: treatment.receiptId, comparisons, causalStatus: 'observational-only', sourceSupport: 'not-assessed',
    executorReliance: 'not-measured', taskOutcome: 'not-assessed', decision: null });
};
