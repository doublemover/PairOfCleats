import assert from 'node:assert/strict';
import { deriveInvestigation, applyInvestigationEvent, projectInvestigationPacket }
  from '../../../src/context-pack/task-evidence/investigation.js';
import { evaluateSupportJoin } from '../../../src/context-pack/task-evidence/support-join.js';

const world = build => ({ repositoryNamespace: 'repo', generation: { baseBuildId: build, semanticRevision: 0 },
  sourceSnapshotId: `sources-${build}`, contextKey: 'configured-build', domainId: 'js-lexical', producerId: 'provider-v1' });
const ref = digit => ({ sourceUnitId: `su1:${digit.repeat(64)}`, span: [0, 15], coordinateUnit: 'utf16' });
const request = { investigationId: 'task', taskRevision: 'intent-1', branchId: 'main', assumptionSetId: 'assumptions-1',
  beforeWorldRef: world('old'), afterWorldRef: world('new'),
  changes: [{ id: 'signature', kind: 'signature', correspondence: 'checked', beforeRef: ref('a'), afterRef: ref('b') }] };
const admitted = { relations: [{ id: 'caller', changeId: 'signature', side: 'before', kind: 'calls',
  certainty: 'may', sourceRef: ref('c') }], relationClosure: 'partial' };
let state = deriveInvestigation(request, admitted);
assert.equal(state.obligations.length, 3);
assert.match(state.obligations[1].reason, /impact is unverified/);
assert.equal(state.obligations[2].requirement.predicateId, 'dependent-enumeration-complete');
assert.deepEqual(deriveInvestigation(request, admitted), state, 'checklist must be deterministic');
const requirement = state.obligations[0].requirement;
const observation = (id, extra = {}) => ({ ...structuredClone(requirement),
  id, role: 'changed-source', kind: 'source-inspection', polarity: 'supports',
  foundation: true, dependencies: [], admission: 'checked', checkerReceiptId: `check-${id}`, validity: 'current', ...extra });
let serial = 0;
const apply = (kind, payload = {}) => {
  const event = { id: `event-${++serial}`, kind, taskRevision: state.taskRevision,
    branchId: state.branchId, expectedProjectionRevision: state.projectionRevision, ...payload };
  state = applyInvestigationEvent(state, event);
  return event;
};
const recorded = apply('observe', { observation: observation('source-1') });
assert.equal(state.obligations[0].status, 'open', 'an observation does not admit its own support');
assert.equal(applyInvestigationEvent(state, recorded), state, 'identical replay is idempotent after other revisions');
assert.throws(() => applyInvestigationEvent(state, { ...recorded, kind: 'closeByCaller' }), /different payload/);
apply('admitSupport', { observationIds: ['source-1'] });
assert.equal(state.obligations[0].status, 'supported');
assert.equal(state.obligations[2].status, 'open', 'inspected source cannot discharge missing universe closure');
apply('observe', { observation: observation('source-2') });
apply('admitSupport', { observationIds: ['source-2'] });
apply('invalidate', { observationIds: ['source-1'] });
assert.equal(state.obligations[0].status, 'supported', 'independent alternative survives invalidation');
apply('invalidate', { observationIds: ['source-2'] });
assert.equal(state.obligations[0].status, 'stale', 'sole remaining support loss retracts satisfaction');
apply('observe', { observation: observation('old-build', { worldRef: world('old') }) });
apply('admitSupport', { observationIds: ['old-build'] });
assert.equal(state.obligations[0].status, 'stale', 'same role from old build cannot discharge new-world predicate');
assert.throws(() => applyInvestigationEvent(state, { id: 'late', kind: 'observe', taskRevision: 'old-intent',
  branchId: 'main', expectedProjectionRevision: state.projectionRevision, observation: observation('late') }), /Stale/);
apply('closeByCaller');
assert.equal(state.workflow, 'closed-by-caller');
assert.equal(state.obligations[0].status, 'stale', 'closing a workflow cannot manufacture evidence support');
const page = projectInvestigationPacket(state, { limit: 1 });
assert.equal(page.nextOffset, 1);
assert.equal(page.omittedCount, 2);
assert.equal(state.obligations.length, 3);

const requirementWithRoles = { ...requirement, alternatives: [['changed-source', 'configuration'], ['native-check']] };
const join = rows => evaluateSupportJoin({ requirement: requirementWithRoles, observations: rows });
assert.equal(join([observation('source')]).status, 'open');
assert.equal(join([observation('source'), observation('config', { role: 'configuration' })]).status, 'supported');
assert.equal(join([observation('native', { role: 'native-check' })]).status, 'supported');
assert.equal(join([observation('native', { role: 'native-check' }), observation('counter', { polarity: 'refutes' })]).status, 'conflicted');
assert.equal(join([observation('source'), observation('other-branch-config', { role: 'configuration', branchId: 'hypothesis-2' })]).status, 'open');
assert.equal(join([observation('cycle-a', { role: 'native-check', foundation: false, dependencies: ['cycle-b'] }),
  observation('cycle-b', { foundation: false, dependencies: ['cycle-a'] })]).status, 'open');
assert.equal(join([observation('unsupported', { role: 'native-check', admission: 'unverified' })]).status, 'open');
const ambiguous = structuredClone(request);
ambiguous.changes[0].correspondence = 'proposed';
assert.equal(deriveInvestigation(ambiguous).obligations[0].kind, 'inspect-correspondence');
const added = structuredClone(request);
added.changes[0] = { id: 'added', kind: 'addition', afterRef: ref('d') };
assert.ok(deriveInvestigation(added).obligations.some(row => row.kind === 'discover-dependents'));
console.log('change investigation support and invalidation contract passed');
