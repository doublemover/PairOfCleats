import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';

const key = canonicalSemanticJson;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const kinds = new Set(['search-anchor', 'disambiguate', 'read-source', 'follow-relation', 'source-witness', 'refine', 'revalidate']);
const dimensions = ['calls', 'sourceBytes', 'work'];
const limitsValid = limits => limits && Object.keys(limits).length === dimensions.length
  && dimensions.every(name => Number.isSafeInteger(limits[name]) && limits[name] >= 0);
const compareId = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export const evidenceActionKey = (state, action) => semanticHash('pairofcleats.evidence-action.v1', {
  runId: state.runId, taskRevision: state.taskRevision, branchId: state.branchId,
  assumptionSetId: state.assumptionSetId, worldRef: action.worldRef,
  ownerId: action.ownerId, capability: action.capability, capabilityVersion: action.capabilityVersion,
  kind: action.kind, arguments: action.arguments, predicateId: action.predicateId, expectedRole: action.expectedRole
});

/** Pure deterministic advisor. It chooses an already-admitted read, never executes it. */
export const planNextEvidence = (state, capabilityManifest) => {
  if (!state || !['runId', 'taskRevision', 'branchId', 'assumptionSetId'].every(name => text(state[name]))
    || !Array.isArray(state.worldRefs) || !state.worldRefs.length || state.worldRefs.length > 16
    || !Array.isArray(state.obligations) || state.obligations.length > 16384
    || !Array.isArray(state.actions) || state.actions.length > 16384
    || !Array.isArray(state.attempts) || state.attempts.length > 65536
    || !(capabilityManifest instanceof Map) || !limitsValid(state.remainingBudget)) throw new TypeError('Invalid bounded evidence advisory state.');
  const deficits = state.obligations.filter(row => row.status !== 'supported');
  const frontierDigest = semanticHash('pairofcleats.evidence-frontier.v1', {
    taskRevision: state.taskRevision, branchId: state.branchId, assumptionSetId: state.assumptionSetId,
    deficits: deficits.map(row => ({ id: row.id, status: row.status,
      requirement: row.requirement, supportJoin: row.supportJoin || null })).sort((a, b) => compareId(a.id, b.id)),
    admittedEvidence: [...(state.admittedEvidenceIds || [])].sort(), ownerProgress: state.ownerProgress || []
  });
  const admitted = [], excluded = [];
  const seen = new Set();
  for (const action of state.actions) {
    if (!action || !kinds.has(action.kind) || !['id', 'ownerId', 'capability', 'capabilityVersion', 'predicateId', 'expectedRole', 'obligationId'].every(name => text(action[name]))
      || action.executionClass !== 'read-only' || !limitsValid(action.hardLimits)
      || !state.worldRefs.some(world => key(world) === key(action.worldRef))) {
      excluded.push({ id: action?.id || null, reason: 'unsupported-or-out-of-scope-action' }); continue;
    }
    const obligation = deficits.find(row => row.id === action.obligationId);
    if (!obligation || key(obligation.requirement.worldRef) !== key(action.worldRef)
      || obligation.requirement.predicateId !== action.predicateId
      || !obligation.requirement.alternatives.some(roles => roles.includes(action.expectedRole))) {
      excluded.push({ id: action.id, reason: 'action-does-not-address-current-deficit' }); continue;
    }
    const capability = capabilityManifest.get(`${action.ownerId}/${action.capability}`);
    if (!capability || capability.version !== action.capabilityVersion || capability.executionClass !== 'read-only'
      || capability.authorized !== true || !capability.kinds.includes(action.kind)
      || !capability.worldRefs.some(world => key(world) === key(action.worldRef))
      || action.argumentAdmissionId !== semanticHash('pairofcleats.owner-admitted-read.v1', action.arguments)) {
      excluded.push({ id: action.id, reason: 'owner-capability-or-authority-unavailable' }); continue;
    }
    const actionKey = evidenceActionKey(state, action);
    if (seen.has(actionKey)) continue;
    seen.add(actionKey);
    if (state.attempts.some(attempt => attempt.actionKey === actionKey && attempt.frontierDigest === frontierDigest)
      && !(state.retryActionIds || []).includes(action.id)) {
      excluded.push({ id: action.id, reason: 'unchanged-frontier-repeat' }); continue;
    }
    if (dimensions.some(name => action.hardLimits[name] > state.remainingBudget[name])) {
      excluded.push({ id: action.id, reason: 'parent-budget-insufficient' }); continue;
    }
    const priority = obligation.status === 'stale' && action.kind === 'revalidate' ? 0
      : action.kind === 'disambiguate' ? 1 : action.kind === 'read-source' ? 2
        : obligation.status === 'conflicted' || obligation.status === 'contradicted' ? 4 : 3;
    const estimatedCost = Number.isFinite(action.estimatedWork) && action.estimatedWork >= 0 ? action.estimatedWork : Infinity;
    admitted.push({ action, actionKey, priority, estimatedCost,
      whyThisNow: priority === 0 ? 'Revalidate stale required evidence before using it.'
        : priority === 1 ? 'Resolve the required binding ambiguity before source expansion.'
          : priority === 2 ? `Read exact source for missing role: ${action.expectedRole}.`
            : `Acquire the unresolved ${action.expectedRole} evidence for ${action.predicateId}.` });
  }
  admitted.sort((a, b) => a.priority - b.priority || a.estimatedCost - b.estimatedCost || compareId(a.action.id, b.action.id));
  const project = row => ({ ...structuredClone(row.action), actionKey: row.actionKey, whyThisNow: row.whyThisNow });
  const supported = state.obligations.length > 0 && deficits.length === 0;
  return {
    schemaVersion: 1, policyId: 'deterministic-next-read-v1', runId: state.runId, taskRevision: state.taskRevision,
    branchId: state.branchId, frontierDigest, selectedAction: admitted.length ? project(admitted[0]) : null,
    alternatives: admitted.slice(1, 4).map(project), omittedAlternatives: Math.max(0, admitted.length - 4),
    deficits: deficits.map(row => ({ id: row.id, status: row.status, predicateId: row.requirement.predicateId })), excluded,
    stopReason: admitted.length ? null : supported ? 'supported-within-declared-scope'
      : excluded.some(row => row.reason === 'parent-budget-insufficient') ? 'budget-exhausted' : 'no-permitted-useful-read',
    statusAxes: { namedRequirementSupport: supported ? 'supported' : 'unresolved',
      semanticClosure: 'not-implied', rankingCompletion: 'not-assessed', taskOutcome: 'not-assessed' },
    remainingBudget: { ...state.remainingBudget }, execution: 'none'
  };
};

/** Investigation consumer seam: only supplied owner-admitted actions are considered. */
export const planInvestigationEvidence = ({ investigation, runId, actions, attempts = [], remainingBudget,
  capabilityManifest, ownerProgress = [] }) => planNextEvidence({
  runId, taskRevision: investigation.taskRevision, branchId: investigation.branchId,
  assumptionSetId: investigation.assumptionSetId, worldRefs: [investigation.beforeWorldRef, investigation.afterWorldRef],
  obligations: investigation.obligations, admittedEvidenceIds: investigation.admittedIds,
  actions, attempts, remainingBudget, ownerProgress
}, capabilityManifest);
