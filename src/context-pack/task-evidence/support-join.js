import { stableStringify } from '../../shared/stable-json.js';

const same = (left, right) => stableStringify(left) === stableStringify(right);
const identity = value => typeof value === 'string' && value.length > 0;

/**
 * Join already-admitted checker observations, never infer checks from retrieval
 * scores or prose. Exact world equality is the only admitted compatibility rule
 * in this pilot; checked cross-world translation belongs to a future adapter.
 */
export const evaluateSupportJoin = ({ requirement, observations, invalidated = [] }) => {
  if (!requirement || !identity(requirement.id) || !identity(requirement.predicateId)
    || !identity(requirement.branchId) || !identity(requirement.assumptionSetId)
    || !requirement.worldRef || !Number.isSafeInteger(requirement.predicateVersion)
    || requirement.predicateVersion < 1 || !Array.isArray(requirement.permittedKinds)
    || !requirement.permittedKinds.length
    || !Array.isArray(requirement.alternatives) || !requirement.alternatives.length
    || requirement.alternatives.some(roles => !Array.isArray(roles) || !roles.length
      || roles.some(role => !identity(role)) || new Set(roles).size !== roles.length)) {
    throw new TypeError('A named predicate and nonempty alternative role bundles are required.');
  }
  const revoked = new Set(invalidated);
  const byId = new Map();
  for (const observation of observations) {
    if (!identity(observation?.id) || byId.has(observation.id)
      || !Array.isArray(observation.dependencies)) throw new TypeError('Unique observations with explicit dependencies required.');
    byId.set(observation.id, observation);
  }
  // Least fixed point: unsupported cycles never manufacture foundational support.
  const grounded = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const observation of observations) {
      if (grounded.has(observation.id) || revoked.has(observation.id)
        || observation.validity !== 'current' || observation.admission !== 'checked'
        || !identity(observation.checkerReceiptId)
        || !same(observation.worldRef, requirement.worldRef)
        || observation.branchId !== requirement.branchId
        || observation.assumptionSetId !== requirement.assumptionSetId) continue;
      if (observation.dependencies.every(id => grounded.has(id))
        && (observation.dependencies.length || observation.foundation === true)) {
        grounded.add(observation.id);
        changed = true;
      }
    }
  }
  const compatible = observations.filter(observation => grounded.has(observation.id)
    && observation.predicateId === requirement.predicateId
    && observation.predicateVersion === requirement.predicateVersion
    && same(observation.arguments, requirement.arguments)
    && same(observation.quantifierScope, requirement.quantifierScope)
    && requirement.permittedKinds.includes(observation.kind));
  const refutations = compatible.filter(observation => observation.polarity === 'refutes');
  const alternatives = requirement.alternatives.map(roles => {
    const witnesses = roles.map(role => ({ role, evidenceIds: compatible
      .filter(observation => observation.polarity === 'supports' && observation.role === role)
      .map(observation => observation.id).sort() }));
    return { witnesses, missingRoles: witnesses.filter(row => !row.evidenceIds.length).map(row => row.role) };
  });
  const satisfied = alternatives.some(alternative => !alternative.missingRoles.length);
  return {
    requirementId: requirement.id, predicateId: requirement.predicateId,
    compatibilityRule: 'exact-world-branch-assumptions-v1',
    status: refutations.length ? (satisfied ? 'conflicted' : 'contradicted') : satisfied ? 'supported' : 'open',
    alternatives, refutationIds: refutations.map(row => row.id).sort(),
    rejectedIds: observations.filter(row => !grounded.has(row.id)).map(row => row.id).sort(),
    semanticClosure: 'not-implied', taskOutcome: 'not-assessed'
  };
};
