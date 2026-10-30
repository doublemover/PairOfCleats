import { canonicalSemanticJson } from '../index/semantic/identity.js';
import { validateSemanticRecord } from '../contracts/validators/semantic.js';
import { throwIfAborted } from '../shared/abort.js';

const integrity = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_INTEGRITY' });
const runtimeValueKinds = new Set(['expression', 'occurrence', 'literal', 'declaration', 'externalDeclaration', 'value', 'boundary']);

/** Opt-in validation reads at most six current-generation records per edge.
 * No record cache, complete graph scan or feasibility inference is introduced.
 * Missing modeled metadata remains an explicit frontier with its original edge.
 */
export const inspectSemanticPathEdge = async ({ store, edge, owner, direction, kinds, semantics, signal }) => {
  throwIfAborted(signal);
  if (!validateSemanticRecord('edge', edge).ok || !kinds.includes(edge.kind)
    || canonicalSemanticJson(edge[direction === 'downstream' ? 'from' : 'to']) !== canonicalSemanticJson(owner)) {
    throw integrity('Semantic path edge differs from its selected relation owner.');
  }
  if (typeof store.getPartitionSourceUnitId !== 'function') {
    throw Object.assign(new Error('Path validation requires the pinned partition inventory.'), { code: 'ERR_SEMANTIC_UNAVAILABLE' });
  }
  const refs = [...new Map([edge.from, edge.to, edge.callSite, edge.evidence, edge.condition]
    .filter(Boolean).map(ref => [canonicalSemanticJson(ref), ref])).values()];
  const rows = await store.getRecords(refs, ['data'], { signal });
  throwIfAborted(signal);
  const records = new Map();
  for (let index = 0; index < refs.length; index++) {
    const ref = refs[index], row = rows[index];
    if (!row || canonicalSemanticJson(row.ref) !== canonicalSemanticJson(ref) || !store.getPartitionSourceUnitId(ref.partitionId)) {
      throw integrity('Semantic path edge references an absent record or foreign partition.');
    }
    records.set(canonicalSemanticJson(ref), row);
  }
  const record = ref => ref ? records.get(canonicalSemanticJson(ref)) : null;
  if (edge.evidence && record(edge.evidence).kind !== 'evidence') throw integrity('Semantic path evidence reference is not an evidence record.');
  let frontier = edge.evidence ? null : 'edge_evidence_unavailable';
  if (!['argumentToParameter', 'returnToResult'].includes(edge.kind)) return { frontier, traverse: true };
  if (!runtimeValueKinds.has(record(edge.from).kind) || !runtimeValueKinds.has(record(edge.to).kind)) {
    throw integrity('Call-channel domain or range is incompatible with retained runtime values.');
  }
  if (edge.callSite) {
    const site = record(edge.callSite);
    if (!['expression', 'occurrence'].includes(site.kind)) throw integrity('Call-channel site has an incompatible retained record kind.');
    const caller = edge.kind === 'argumentToParameter' ? edge.from : edge.to;
    if (store.getPartitionSourceUnitId(caller.partitionId) !== store.getPartitionSourceUnitId(edge.callSite.partitionId)) {
      throw integrity('Call-channel site is not owned by its caller source.');
    }
    if (edge.kind === 'argumentToParameter' && edge.operandOrdinal !== null && record(edge.from).kind !== 'value') {
      let invocation = site;
      if (site.kind === 'occurrence' && site.data.expression) {
        [invocation] = await store.getRecords([site.data.expression], ['data'], { signal });
        throwIfAborted(signal);
        if (!invocation || canonicalSemanticJson(invocation.ref) !== canonicalSemanticJson(site.data.expression)
          || store.getPartitionSourceUnitId(invocation.ref.partitionId) !== store.getPartitionSourceUnitId(edge.callSite.partitionId)) {
          throw integrity('Call-channel occurrence has no expression in its retained caller source.');
        }
      }
      const count = invocation?.kind === 'expression' ? invocation.data.syntacticArgumentCount : null;
      if (count !== null && edge.operandOrdinal >= count) {
        if (edge.certainty === 'exact-static') throw integrity('Call-channel operand ordinal exceeds the retained source invocation.');
        frontier = 'operand_validation_unavailable';
      }
    }
  }
  if (semantics === 'relation-neighborhood') return { frontier, traverse: true };
  if (!edge.callSite || !edge.contextKey) return { frontier: 'call_context_unavailable', traverse: false };
  if (edge.kind === 'argumentToParameter' && edge.operandOrdinal === null) return { frontier: 'call_operand_unavailable', traverse: false };
  return { frontier, traverse: true };
};
