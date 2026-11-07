import { createHash } from 'node:crypto';
import { stableStringify } from '../../shared/stable-json.js';

export const CHANGE_RULES_VERSION = 1;
export const changeEvidenceId = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const supportedKinds = new Set(['signature', 'visibility', 'import', 'body', 'deletion', 'addition']);

/** Pure checklist construction from caller-admitted source changes and relations. */
export const deriveChangeObligations = ({ changes, relations, beforeWorldRef, afterWorldRef,
  branchId, assumptionSetId, relationClosure }) => {
  const obligations = [];
  const append = (change, kind, sourceRefs, reason, worldRef, roles) => {
    const id = changeEvidenceId({ change: change.id, kind, sourceRefs, worldRef, branchId, assumptionSetId });
    obligations.push({ id, triggerChangeId: change.id, kind, sourceRefs: structuredClone(sourceRefs), reason,
      origin: 'change-rule', status: 'open', requirement: {
        id, predicateId: kind === 'discover-dependents' ? 'dependent-enumeration-complete' : 'source-inspected',
        predicateVersion: 1, arguments: { changeId: change.id, sourceRefs: structuredClone(sourceRefs) },
        quantifierScope: kind === 'discover-dependents' ? 'declared-dependent-universe' : 'named-source-only',
        branchId, assumptionSetId, worldRef: structuredClone(worldRef), alternatives: [roles],
        permittedKinds: kind === 'discover-dependents' ? ['closed-enumeration'] : ['source-inspection']
      } });
  };
  const ordered = [...changes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const change of ordered) {
    if (!supportedKinds.has(change.kind)) throw new TypeError('Unsupported change category.');
    const refs = [change.beforeRef, change.afterRef].filter(Boolean);
    if (!refs.length) throw new TypeError('A change must retain source navigation references.');
    if (change.correspondence !== 'checked' && change.beforeRef && change.afterRef) {
      append(change, 'inspect-correspondence', refs,
        'Entity correspondence remains unresolved; similarity does not establish identity.', afterWorldRef, ['correspondence-source']);
      continue;
    }
    append(change, 'inspect-change', refs,
      `${change.kind} change requires source inspection; behavior compatibility remains unverified.`,
      afterWorldRef, ['changed-source']);
    for (const relation of relations.filter(row => row.changeId === change.id)
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      if (!['before', 'after'].includes(relation.side) || !relation.sourceRef
        || !['exact-in-model', 'may', 'observed', 'heuristic'].includes(relation.certainty)) {
        throw new TypeError('Qualified old/new relation required.');
      }
      append(change, `inspect-dependent:${relation.id}`, [relation.sourceRef],
        `${relation.side} ${relation.kind} relation (${relation.certainty}) warrants inspection; impact is unverified.`,
        relation.side === 'before' ? beforeWorldRef : afterWorldRef, ['dependent-source']);
    }
    // A supplied populated graph is not proof of complete caller discovery.
    if (relationClosure !== 'complete-in-model') append(change, 'discover-dependents', refs,
      'Dependent discovery is incomplete; missing relations do not prove no impact.', afterWorldRef, ['closed-universe']);
  }
  return obligations;
};
