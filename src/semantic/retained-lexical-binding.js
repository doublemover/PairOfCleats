import { resolveCanonicalLexicalBinding } from './lexical-binding.js';
import { captureRetainedLexicalInputs, retainedLexicalInputError, retainedLexicalSourceSpan } from './retained-lexical-inputs.js';
import { validateSemanticRecord } from '../contracts/validators/semantic.js';
import { canonicalSemanticJson } from '../index/semantic/identity.js';
import { throwIfAborted } from '../shared/abort.js';
import { materializeTaskLens } from '../context-pack/task-evidence/lens.js';

const key = canonicalSemanticJson;
const fail = retainedLexicalInputError;

/** Actual retained syntax feeds the existing lexical model. Profile closure,
 * namespace/datum equivalence and accessibility remain upstream admitted inputs. */
const captureAndResolveRetainedBinding = async ({ store, query, maxVisits = 4096, maxCandidates = 128,
  maxWitnessRefs = 16384, signal = null, ...request }) => {
  throwIfAborted(signal);
  query = JSON.parse(key(query));
  if (!validateSemanticRecord('recordRef', query?.occurrence).ok
    || !validateSemanticRecord('recordRef', query?.startScope).ok
    || !query.occurrence.partitionId.startsWith('sy1:') || query.startScope.partitionId !== query.occurrence.partitionId) {
    throw fail('Bounded generation-pinned retained lexical inputs required.');
  }
  const inputs = await captureRetainedLexicalInputs({ ...request, store, signal,
    partitionId: query.occurrence.partitionId, selection: { query } });
  const { world, profile, closures, annotations, captured, records, byRef } = inputs;
  query = inputs.selection.query;
  const [row] = await store.getRecords([query.occurrence], ['span', 'scope', 'data'], { signal });
  throwIfAborted(signal);
  if (!row || row.kind !== 'occurrence' || key(row.ref) !== key(query.occurrence)
    || key(row.scope) !== key(query.startScope)) throw fail('Binding query must start at its retained occurrence scope.');
  const occurrence = inputs.pin(row), scanned = byRef.get(key(query.occurrence));
  if (!retainedLexicalSourceSpan(captured.text, occurrence.span)) throw fail('Retained lexical occurrence has unavailable source coordinates.');
  if (scanned && key(scanned) !== key({ id: occurrence.id, kind: occurrence.kind,
    span: occurrence.span, scope: occurrence.scope, data: occurrence.data })) throw fail('Retained lexical occurrence changed during projection.');
  const partitionId = inputs.projection.partitionId;
  const answer = resolveCanonicalLexicalBinding({ partitions: [{ partitionId, records }],
    closures, annotations, world, profile, query, maxVisits, maxCandidates, maxWitnessRefs, signal });
  if (inputs.projection.truncated) answer.frontier.push({ reason: 'retained-input-row-budget', scope: structuredClone(query.startScope) });
  const witness = (ref, record) => ({ ref: structuredClone(ref), sourceUnitId: captured.source.sourceUnitId,
    sourceHash: captured.source.byteHash, path: captured.source.path, coordinateUnit: 'utf16', span: [...record.span] });
  const result = { ...answer, sourceWitnesses: [witness(query.occurrence, occurrence), ...answer.targets.map(ref => witness(ref, byRef.get(key(ref))))],
    projection: { ...inputs.projection, retainedMetadataBytes: inputs.metadataBytes() } };
  throwIfAborted(signal);
  return { answer: result, snapshot: captured.snapshot };
};

export const resolveRetainedCanonicalLexicalBinding = async request => (await captureAndResolveRetainedBinding(request)).answer;

/** One source capture feeds the existing exact-source task lens. All ambiguity
 * candidates are mandatory, so preview limits cannot manufacture a unique target. */
export const materializeRetainedLexicalBindingLens = async ({ taskId, retainedResult, maxFacets = 12, ...request }) => {
  const { answer, snapshot } = await captureAndResolveRetainedBinding(request);
  const candidates = answer.sourceWitnesses.map((sourceRef, index) => ({ id: key(sourceRef.ref), kind: 'binding',
    sourceRef: { sourceUnitId: sourceRef.sourceUnitId, span: sourceRef.span, coordinateUnit: sourceRef.coordinateUnit },
    worldRef: answer.world, score: 1, mandatory: true, roles: [index === 0 ? 'reference' : 'candidate'],
    qualification: { certainty: answer.certainty, closure: answer.completeInProfile ? 'complete-in-declared-lexical-profile' : 'partial',
      bindingStatus: answer.status, profileId: answer.profileId, sourceLanguageClosure: 'not-implied' },
    reason: index === 0 ? 'Retained occurrence selected for this lexical profile query.'
      : 'Candidate retained by the declared lexical profile; native language binding remains unqualified.' }));
  return { answer, lens: materializeTaskLens({ taskId, worldRef: answer.world, retainedResult, maxFacets,
    requiredRoles: ['reference', 'candidate'], candidates, sources: [snapshot] }) };
};
