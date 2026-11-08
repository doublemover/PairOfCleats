import assert from 'node:assert/strict';
import { planInvestigationEvidence } from '../../../src/context-pack/task-evidence/controller.js';
import { deriveInvestigation } from '../../../src/context-pack/task-evidence/investigation.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';

const world = { repositoryNamespace: 'repo', generation: { baseBuildId: 'base', semanticRevision: 0 },
  sourceSnapshotId: 'source', contextKey: 'build', domainId: 'lexical', producerId: 'provider' };
const sourceRef = { sourceUnitId: `su1:${'a'.repeat(64)}`, span: [0, 1], coordinateUnit: 'utf16' };
const investigation = deriveInvestigation({ investigationId: 'task', taskRevision: 'intent', branchId: 'branch', assumptionSetId: 'assumptions',
  beforeWorldRef: world, afterWorldRef: world, changes: [{ id: 'body', kind: 'body', afterRef: sourceRef }] });
const requirement = investigation.obligations[0].requirement;
const make = (id, kind) => ({ id, kind, executionClass: 'read-only', ownerId: 'source-owner', capability: 'source-read',
  capabilityVersion: '1', predicateId: requirement.predicateId, expectedRole: 'changed-source',
  obligationId: requirement.id, worldRef: world, arguments: { sourceRef },
  argumentAdmissionId: semanticHash('pairofcleats.owner-admitted-read.v1', { sourceRef }),
  hardLimits: { calls: 1, sourceBytes: 1024, work: 1 }, estimatedWork: 1 });
const capabilityManifest = new Map([['source-owner/source-read', { version: '1', executionClass: 'read-only', authorized: true,
  kinds: ['read-source', 'disambiguate', 'revalidate'], worldRefs: [world] }]]);
const args = { investigation, runId: 'run', actions: [make('read', 'read-source'), make('ambiguity', 'disambiguate')],
  remainingBudget: { calls: 2, sourceBytes: 2048, work: 2 }, capabilityManifest };
const first = planInvestigationEvidence(args);
assert.equal(first.selectedAction.kind, 'disambiguate');
assert.equal(first.execution, 'none');
assert.equal(first.statusAxes.namedRequirementSupport, 'unresolved');
const second = planInvestigationEvidence({ ...args, attempts: [{ actionKey: first.selectedAction.actionKey, frontierDigest: first.frontierDigest }] });
assert.equal(second.selectedAction.kind, 'read-source', 'unchanged failed/completed attempts do not loop');
const budget = planInvestigationEvidence({ ...args, remainingBudget: { calls: 0, sourceBytes: 0, work: 0 } });
assert.equal(budget.stopReason, 'budget-exhausted');
assert.equal(budget.selectedAction, null);
const denied = new Map([['source-owner/source-read', { ...capabilityManifest.get('source-owner/source-read'), authorized: false }]]);
assert.equal(planInvestigationEvidence({ ...args, capabilityManifest: denied }).selectedAction, null);
assert.equal(planInvestigationEvidence({ ...args, actions: [{ ...make('shell', 'read-source'), executionClass: 'shell' }] }).selectedAction, null);
assert.equal(planInvestigationEvidence({ ...args, actions: [{ ...make('stale', 'read-source'), worldRef: { ...world, contextKey: 'other' } }] }).selectedAction, null);
const stale = structuredClone(investigation); stale.obligations[0].status = 'stale';
assert.equal(planInvestigationEvidence({ ...args, investigation: stale, actions: [...args.actions, make('refresh', 'revalidate')] }).selectedAction.kind, 'revalidate');
const withRanking = planInvestigationEvidence({ ...args, ownerProgress: [{ orderCertified: true, scoreInterval: { lower: 1, upper: 2 } }] });
assert.equal(withRanking.statusAxes.namedRequirementSupport, 'unresolved', 'ranking proof never fills an evidence role');
assert.notEqual(withRanking.frontierDigest, first.frontierDigest, 'owner proof progress permits a new action evaluation');
console.log('deterministic next-evidence advisor contract passed');
