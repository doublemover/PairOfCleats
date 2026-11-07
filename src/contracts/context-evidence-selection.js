import { stableStringify } from '../shared/stable-json.js';
import { contextDigest } from './context-token-budget.js';
import { contextTaskProjectionErrors } from './context-task.js';

export const CONTEXT_EVIDENCE_ROLES = Object.freeze(['call', 'usage', 'export', 'import']);
export const CONTEXT_EVIDENCE_GRAPH_ROLES = Object.freeze({ callGraph: 'call', usageGraph: 'usage', exportGraph: 'export', importGraph: 'import' });
export const canonicalContextEvidenceRef = input => {
  if (input?.status !== undefined && (input.status !== 'resolved' || !input.resolved)) return { type: 'unqualified' };
  const ref = input?.status === 'resolved' && input.resolved ? input.resolved : input;
  if ((ref?.type === 'chunk' || ref !== input) && typeof ref.chunkUid === 'string' && ref.chunkUid) return { type: 'chunk', chunkUid: ref.chunkUid };
  if ((ref?.type === 'symbol' || ref !== input) && typeof ref.symbolId === 'string' && ref.symbolId) return { type: 'symbol', symbolId: ref.symbolId };
  if ((ref?.type === 'file' || ref !== input) && typeof ref.path === 'string' && ref.path) return { type: 'file', path: ref.path };
  return { type: 'unqualified' };
};
export const contextEvidenceSourceIdentity = primary => ({ file: primary.file, span: primary.unit.span.slice(),
  sourceHash: primary.unit.sourceHash, indexSignature: primary.unit.indexSignature,
  contentHash: primary.unit.contentHash || primary.unit.sourceHash });
export const contextEvidenceUnitId = primary => contextDigest(stableStringify(contextEvidenceSourceIdentity(primary)));
export const contextEvidencePoolDigest = ({ indexSignature, decisions, observed }) => contextDigest(stableStringify({
  indexSignature, observed,
  candidates: decisions.filter(row => row.status !== 'omitted').map(row => ({ id: row.id, unitId: row.unitId,
    roles: row.roles, priority: row.priority, distance: row.distance, sourceIdentity: row.sourceIdentity })),
  omissions: decisions.filter(row => row.status === 'omitted').map(row => ({ id: row.id, ref: row.ref,
    reason: row.reason, roles: row.roles, sourceIdentity: row.sourceIdentity }))
}));

/** Content/source/selection relationships supplement the authoritative shape.
 * Coverage describes graph-incidence heuristics, never semantic sufficiency. */
export const contextEvidenceSelectionProjectionErrors = payload => {
  const section = payload.evidenceSelection;
  if (!section) return payload.evidence?.selection ? ['Evidence selector inclusion has no corresponding section.'] : [];
  const errors = [];
  if (payload.evidence?.policy?.taskPolicy?.task !== 'edit-safe' || payload.tokenAccounting?.status !== 'exact') {
    return ['Evidence-set selection requires intact edit units and exact rendered token accounting.'];
  }
  if (!payload.graph || payload.evidence.selection?.included !== true || payload.evidence.selection?.heuristic !== true
    || payload.evidence.selection.state !== (section.partial ? 'partial' : 'selected')
    || (section.partial || section.coverage.missing.length || section.coverage.unknownRoleIds.length) && payload.evidence.complete !== false) {
    errors.push('Evidence selection completeness differs from its retained graph and frontier.');
  }
  if (section.policyDigest !== contextDigest(stableStringify(section.policy))) errors.push('Evidence selector policy identity differs from its declaration.');
  if (section.poolDigest !== contextEvidencePoolDigest({ indexSignature: payload.provenance.indexSignature,
    decisions: section.decisions, observed: section.stats.observed })) errors.push('Evidence candidate pool identity differs from its retained inputs.');
  const decisions = new Map();
  const graphNodes = Array.isArray(payload.graph?.nodes) ? payload.graph.nodes : [];
  const incidentRoles = new Map();
  for (const edge of payload.graph?.edges || []) {
    const role = CONTEXT_EVIDENCE_GRAPH_ROLES[edge.graph];
    if (!role) continue;
    for (const endpoint of [edge.from, edge.to]) {
      const key = stableStringify(canonicalContextEvidenceRef(endpoint));
      if (!incidentRoles.has(key)) incidentRoles.set(key, new Set());
      incidentRoles.get(key).add(role);
    }
  }
  if (section.stats.observed !== graphNodes.length || payload.graph && payload.graph.provenance?.indexSignature !== payload.provenance.indexSignature) {
    errors.push('Evidence candidates differ from the selected graph generation.');
  }
  for (let rank = 0; rank < section.decisions.length; rank++) {
    const row = section.decisions[rank];
    if (stableStringify(row.ref) !== stableStringify(canonicalContextEvidenceRef(graphNodes[rank]?.ref))) errors.push('Evidence candidate differs from its captured graph position.');
    if (decisions.has(row.id) || row.id !== contextDigest(stableStringify({ ref: row.ref, rank }))) errors.push('Evidence candidate identity/order is not canonical.');
    decisions.set(row.id, row);
    const roles = new Set(incidentRoles.get(stableStringify(row.ref)));
    // Source-qualified aliases contribute their actual graph incidence to one
    // unique intact unit. They never fabricate an absent role.
    if (row.status !== 'omitted') for (const alias of section.decisions) {
      if (alias.reason === 'duplicate-intact-unit' && alias.unitId === row.unitId) {
        for (const role of incidentRoles.get(stableStringify(alias.ref)) || []) roles.add(role);
      }
    }
    const canonicalRoles = CONTEXT_EVIDENCE_ROLES.filter(role => roles.has(role));
    const examined = row.status !== 'omitted' || !['maxWorkUnits', 'maxWallClockMs', 'work-cap', 'pool-or-work-cap', 'selection-cap', 'maxMeasurements'].includes(row.reason);
    if (examined && stableStringify(row.roles) !== stableStringify(canonicalRoles)
      || row.priority !== Math.min(4, ...row.roles.map(role => CONTEXT_EVIDENCE_ROLES.indexOf(role)))) {
      errors.push('Evidence role/priority projection differs from actual graph incidence.');
    }
    const distance = graphNodes[rank]?.distance;
    if (row.distance !== (Number.isFinite(distance) && distance >= 0 ? distance : null)) errors.push('Evidence graph distance differs from its source candidate.');
    if (row.status !== 'omitted' && (row.ref.type !== 'chunk' || !row.unitId || !row.sourceIdentity
      || row.unitId !== contextDigest(stableStringify(row.sourceIdentity)))) errors.push('Eligible evidence candidate lacks its exact source identity.');
  }
  const selected = new Set(), units = new Set([contextEvidenceUnitId(payload.primary)]);
  for (const entry of section.selected) {
    const row = decisions.get(entry.id), unitId = contextEvidenceUnitId(entry);
    if (!row || row.status !== 'selected' || entry.ref.type !== 'chunk' || selected.has(entry.id) || units.has(unitId) || unitId !== entry.unitId
      || row.unitId !== unitId || stableStringify(row.ref) !== stableStringify(entry.ref)
      || stableStringify(row.roles) !== stableStringify(entry.roles)
      || stableStringify(row.sourceIdentity) !== stableStringify(contextEvidenceSourceIdentity(entry))) {
      errors.push('Selected evidence differs from its eligible unique source candidate.');
    }
    selected.add(entry.id); units.add(unitId);
    errors.push(...contextTaskProjectionErrors({ ...payload, primary: entry,
      evidence: { ...payload.evidence, primary: entry.evidence } }));
  }
  if ([...decisions.values()].some(row => row.status === 'selected' && !selected.has(row.id))) errors.push('Selected evidence decision has no included intact unit.');
  const eligible = [...decisions.values()].filter(row => row.status !== 'omitted');
  const eligibleIds = new Set(eligible.map(row => row.id));
  if ([...section.similarity.emptyIds, ...section.similarity.unavailableIds].some(id => !eligibleIds.has(id))
    || section.similarity.emptyIds.some(id => section.similarity.unavailableIds.includes(id))) errors.push('Evidence similarity frontier names contradictory or ineligible candidates.');
  const available = CONTEXT_EVIDENCE_ROLES.filter(role => eligible.some(row => row.roles.includes(role)));
  const covered = CONTEXT_EVIDENCE_ROLES.filter(role => section.selected.some(row => row.roles.includes(role)));
  if (stableStringify(section.coverage.available) !== stableStringify(available)
    || stableStringify(section.coverage.selected) !== stableStringify(covered)
    || stableStringify(section.coverage.missing) !== stableStringify(available.filter(role => !covered.includes(role)))
    || stableStringify(section.coverage.unknownRoleIds) !== stableStringify(eligible.filter(row => !row.roles.length).map(row => row.id))) {
    errors.push('Evidence graph-role coverage differs from its explicit candidate/selected frontier.');
  }
  if (section.selected.length > section.policy.maxSelected || section.decisions.length > section.policy.maxCandidates
    || section.stats.admitted !== eligible.length || section.stats.poolBytes > section.policy.maxPoolBytes
    || section.stats.pairwise > section.policy.maxPairwise || section.stats.measurements > section.policy.maxMeasurements
    || section.stats.workUnits > section.policy.maxWorkUnits || section.stats.measurements < 1
    || section.decisions.length !== Math.min(section.stats.observed, section.policy.maxCandidates)
    || section.stats.omittedBeyondPool !== section.stats.observed - section.decisions.length) {
    errors.push('Evidence selector counters exceed or contradict their declared bounds.');
  }
  return errors;
};
