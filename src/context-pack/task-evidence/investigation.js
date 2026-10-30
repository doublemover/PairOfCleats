import { validateSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';
import { stableStringify } from '../../shared/stable-json.js';
import { CHANGE_RULES_VERSION, changeEvidenceId, deriveChangeObligations } from './change-rules.js';
import { evaluateSupportJoin } from './support-join.js';

const requireText = (value, name) => {
  if (typeof value !== 'string' || !value.length) throw new TypeError(`Missing ${name}.`);
};
const assertWorld = world => {
  if (!world || !validateSemanticEnvelope('generation', world.generation).ok) throw new TypeError('Canonical generation required.');
  for (const key of ['repositoryNamespace', 'sourceSnapshotId', 'contextKey', 'domainId', 'producerId']) requireText(world[key], key);
};
const assertRef = ref => {
  if (!ref || !/^su1:[a-f0-9]{64}$/.test(ref.sourceUnitId)
    || !Array.isArray(ref.span) || ref.span.length !== 2
    || ref.span.some(value => !Number.isSafeInteger(value) || value < 0)
    || ref.span[1] < ref.span[0] || ref.coordinateUnit !== 'utf16') throw new TypeError('Canonical UTF-16 source span required.');
};
const conflict = message => { throw Object.assign(new Error(message), { code: 'ERR_INVESTIGATION_CONFLICT' }); };

/** Stateless read-only MVP; snapshots and relations must already be admitted. */
export const deriveInvestigation = (request, admittedEvidence = {}) => {
  for (const key of ['investigationId', 'taskRevision', 'branchId', 'assumptionSetId']) requireText(request?.[key], key);
  assertWorld(request.beforeWorldRef);
  assertWorld(request.afterWorldRef);
  if (request.beforeWorldRef.repositoryNamespace !== request.afterWorldRef.repositoryNamespace) {
    throw new TypeError('Cross-repository changes require a checked correspondence adapter.');
  }
  if (!Array.isArray(request.changes) || !request.changes.length || request.changes.length > 4096) {
    throw new TypeError('A bounded explicit change set is required.');
  }
  const ids = new Set();
  for (const change of request.changes) {
    requireText(change.id, 'change ID');
    if (ids.has(change.id)) throw new TypeError('Duplicate change ID.');
    ids.add(change.id);
    if (change.beforeRef) assertRef(change.beforeRef);
    if (change.afterRef) assertRef(change.afterRef);
  }
  const relations = admittedEvidence.relations || [];
  if (!Array.isArray(relations) || relations.length > 16384) throw new TypeError('Bounded admitted relations required.');
  const relationIds = new Set();
  for (const relation of relations) {
    requireText(relation.id, 'relation ID');
    requireText(relation.kind, 'relation kind');
    if (!ids.has(relation.changeId) || relationIds.has(relation.id)) throw new TypeError('Invalid relation trigger or duplicate identity.');
    relationIds.add(relation.id);
    assertRef(relation.sourceRef);
  }
  const relationClosure = admittedEvidence.relationClosure || 'unavailable';
  if (!['complete-in-model', 'partial', 'unavailable'].includes(relationClosure)) throw new TypeError('Invalid relation closure.');
  const obligations = deriveChangeObligations({ ...request, relations, relationClosure });
  return {
    schemaVersion: 1, rulesVersion: CHANGE_RULES_VERSION,
    investigationId: request.investigationId, taskRevision: request.taskRevision,
    branchId: request.branchId, assumptionSetId: request.assumptionSetId, projectionRevision: 0,
    beforeWorldRef: structuredClone(request.beforeWorldRef), afterWorldRef: structuredClone(request.afterWorldRef),
    changeSetDigest: changeEvidenceId(request.changes), changes: structuredClone(request.changes),
    obligations, observations: [], admittedIds: [], invalidated: [], events: [], workflow: 'open',
    discovery: relationClosure, semanticClosure: 'not-implied', taskOutcome: 'not-assessed'
  };
};

const project = state => {
  state.obligations = state.obligations.map(obligation => {
    const join = evaluateSupportJoin({ requirement: obligation.requirement,
      observations: state.observations.map(row => state.admittedIds.includes(row.id)
        ? row : { ...row, admission: 'unverified' }), invalidated: state.invalidated });
    const previouslySupported = ['supported', 'conflicted', 'stale'].includes(obligation.status);
    const status = join.status === 'open' && previouslySupported ? 'stale' : join.status;
    return { ...obligation, status, supportJoin: join };
  });
  return state;
};

/** Pure CAS reducer: no I/O, execution authority, saved prompts or automatic edits. */
export const applyInvestigationEvent = (current, event) => {
  requireText(event?.id, 'event ID');
  const digest = changeEvidenceId(event);
  const existing = current.events.find(row => row.id === event.id);
  if (existing) {
    if (existing.digest !== digest) conflict('Event ID reused with a different payload.');
    return current;
  }
  if (event.taskRevision !== current.taskRevision || event.branchId !== current.branchId
    || event.expectedProjectionRevision !== current.projectionRevision) conflict('Stale task, branch or projection revision.');
  const next = structuredClone(current);
  if (event.kind === 'observe') {
    const observation = event.observation;
    requireText(observation?.id, 'observation ID');
    assertWorld(observation.worldRef);
    if (observation.branchId !== current.branchId || observation.assumptionSetId !== current.assumptionSetId) {
      conflict('Observation belongs to different assumptions or branch.');
    }
    if (!Array.isArray(observation.dependencies) || observation.dependencies.some(id => typeof id !== 'string')
      || !['checked', 'unverified'].includes(observation.admission)
      || !['current', 'stale', 'unknown'].includes(observation.validity)
      || !['supports', 'refutes', 'observes'].includes(observation.polarity)) throw new TypeError('Invalid observation envelope.');
    // The transport adapter must validate a named checker receipt before admission.
    if (observation.admission === 'checked' && !observation.checkerReceiptId) throw new TypeError('Checker receipt required.');
    const previous = next.observations.find(row => row.id === observation.id);
    if (previous && stableStringify(previous) !== stableStringify(observation)) conflict('Observation identity conflict.');
    if (!previous) next.observations.push(structuredClone(observation));
  } else if (event.kind === 'admitSupport') {
    if (!Array.isArray(event.observationIds) || !event.observationIds.length
      || event.observationIds.some(id => !next.observations.some(row => row.id === id
        && row.admission === 'checked' && row.checkerReceiptId))) {
      throw new TypeError('Only named checker observations can be admitted as support.');
    }
    next.admittedIds = [...new Set([...next.admittedIds, ...event.observationIds])].sort();
  } else if (event.kind === 'invalidate') {
    if (!Array.isArray(event.observationIds) || event.observationIds.some(id => typeof id !== 'string')) throw new TypeError('Invalid invalidation set.');
    next.invalidated = [...new Set([...next.invalidated, ...event.observationIds])].sort();
  } else if (event.kind === 'closeByCaller') {
    next.workflow = 'closed-by-caller';
  } else throw new TypeError('Unsupported investigation event.');
  next.events.push({ id: event.id, digest });
  next.projectionRevision++;
  return project(next);
};

/** A presentation window does not delete retained obligations or evidence. */
export const projectInvestigationPacket = (state, { offset = 0, limit = 20 } = {}) => {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 128) {
    throw new TypeError('Invalid investigation page.');
  }
  const end = Math.min(state.obligations.length, offset + limit);
  return {
    schemaVersion: 1, investigationId: state.investigationId, taskRevision: state.taskRevision,
    projectionRevision: state.projectionRevision, branchId: state.branchId,
    workflow: state.workflow, obligations: structuredClone(state.obligations.slice(offset, end)),
    totalObligations: state.obligations.length, omittedCount: state.obligations.length - Math.max(0, end - offset),
    nextOffset: end < state.obligations.length ? end : null,
    discovery: state.discovery, semanticClosure: state.semanticClosure, taskOutcome: state.taskOutcome
  };
};
