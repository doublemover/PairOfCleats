import { resolveCanonicalLexicalBinding } from './lexical-binding.js';
import { readRetainedSemanticSourceSnapshot } from './retained-source-snapshot.js';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';
import { validateSemanticRecord } from '../contracts/validators/semantic.js';
import { canonicalSemanticJson, semanticHash } from '../index/semantic/identity.js';
import { throwIfAborted } from '../shared/abort.js';
import { materializeTaskLens } from '../context-pack/task-evidence/lens.js';

const key = canonicalSemanticJson;
const fail = message => Object.assign(new TypeError(message), { code: 'ERR_BINDING_QUERY_CONTRACT' });
const boundary = (text, offset) => offset === 0 || offset === text.length
  || !(text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
    && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);

/** Actual retained syntax feeds the existing lexical model. Profile closure,
 * namespace/datum equivalence and accessibility remain upstream admitted inputs,
 * never inferred from syntax coverage, spellings or a completed physical scan. */
const captureAndResolveRetainedBinding = async ({ store, world, profile, query, closures, annotations,
  maxRows = 16384, maxMetadataBytes = 4 * 1024 * 1024, maxSourceBytes = 8 * 1024 * 1024,
  maxVisits = 4096, maxCandidates = 128, maxWitnessRefs = 16384, signal = null }) => {
  throwIfAborted(signal);
  if (store?.backend !== 'artifact' || !world
    || key(assertSemanticEnvelope('generation', world.generation)) !== key(store.generation)
    || typeof world.repositoryNamespace !== 'string' || !world.repositoryNamespace
    || typeof world.contextKey !== 'string' || !world.contextKey
    || !validateSemanticRecord('recordRef', query?.occurrence).ok
    || !validateSemanticRecord('recordRef', query?.startScope).ok
    || !query.occurrence.partitionId.startsWith('sy1:') || query.startScope.partitionId !== query.occurrence.partitionId
    || !(closures instanceof Map) || closures.size > 16384 || !(annotations instanceof Map) || annotations.size > 65536
    || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 65536
    || !Number.isSafeInteger(maxMetadataBytes) || maxMetadataBytes < 1024 || maxMetadataBytes > 4 * 1024 * 1024
    || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1024 || maxSourceBytes > 8 * 1024 * 1024) {
    throw fail('Bounded generation-pinned retained lexical inputs required.');
  }
  let retainedMetadataBytes = 0;
  const pin = value => {
    const encoded = key(value);
    retainedMetadataBytes += Buffer.byteLength(encoded);
    if (retainedMetadataBytes > maxMetadataBytes) throw fail('Retained lexical metadata allowance exhausted.');
    return JSON.parse(encoded);
  };
  // Snapshot caller-owned profile maps before the first awaited store read.
  world = pin(world); profile = pin(profile); query = pin(query);
  const partitionId = query.occurrence.partitionId;
  const pinMap = input => new Map([...input].map(([ref, value]) => {
    let decoded;
    try { if (typeof ref !== 'string') throw fail('Canonical profile map reference required.'); decoded = JSON.parse(ref); }
    catch { throw fail('Canonical profile map reference required.'); }
    if (!validateSemanticRecord('recordRef', decoded).ok || decoded.partitionId !== partitionId || key(decoded) !== ref) {
      throw fail('Profile annotation refers outside the selected lexical partition.');
    }
    retainedMetadataBytes += Buffer.byteLength(ref);
    return [ref, pin(value)];
  }));
  closures = pinMap(closures); annotations = pinMap(annotations);
  const captured = await readRetainedSemanticSourceSnapshot({ store, partitionId,
    repositoryNamespace: world.repositoryNamespace, maxBytes: maxSourceBytes, signal });
  if (captured.source.mapping !== null) throw fail('Retained lexical binding requires an independently qualified original-source mapping.');
  const sourceSnapshotId = semanticHash('semantic.retained-lexical-source.v1', {
    source: captured.source, partitionId, storeScope: store.cursorScope || null
  });
  if (Object.hasOwn(world, 'sourceSnapshotId') && world.sourceSnapshotId !== sourceSnapshotId) {
    throw fail('Retained lexical source snapshot differs from the requested world.');
  }
  world = { ...world, sourceSnapshotId };
  const [occurrence] = await store.getRecords([query.occurrence], ['span', 'scope', 'data'], { signal });
  if (!occurrence || occurrence.kind !== 'occurrence' || key(occurrence.ref) !== key(query.occurrence)
    || key(occurrence.scope) !== key(query.startScope)) throw fail('Binding query must start at its retained occurrence scope.');
  const sourceSpan = span => Array.isArray(span) && span.length === 2
    && span.every(offset => Number.isSafeInteger(offset) && offset >= 0 && offset <= captured.text.length && boundary(captured.text, offset))
    && span[0] <= span[1];
  if (!sourceSpan(occurrence.span)) throw fail('Retained lexical occurrence has unavailable source coordinates.');
  const records = [], declarations = new Map();
  let scannedRows = 0, truncated = false;
  for await (const record of store.iterateRows(partitionId, 'semantic_records', { signal, batchRows: 1 })) {
    throwIfAborted(signal);
    if (record.id !== scannedRows++) throw fail('Retained lexical syntax IDs are not a dense immutable inventory.');
    if (record.scope !== null && record.scope.partitionId !== partitionId) throw fail('Cross-partition scope is outside the file-local lexical profile.');
    if (record.id === query.occurrence.localId && key(record) !== key({ id: occurrence.id, kind: occurrence.kind,
      span: occurrence.span, scope: occurrence.scope, data: occurrence.data })) throw fail('Retained lexical occurrence changed during projection.');
    if (record.kind === 'scope' || record.kind === 'declaration') {
      if (!sourceSpan(record.span) || record.kind === 'scope' && record.data.parent !== null
        && record.data.parent.partitionId !== partitionId) throw fail('Retained lexical scope or declaration source is unavailable.');
      if (record.kind === 'scope' && key(record.scope) !== key(record.data.parent)) throw fail('Retained lexical scope parent fields disagree.');
      const owned = pin(record);
      records.push(owned);
      if (record.kind === 'declaration') declarations.set(key({ partitionId, localId: record.id }), owned);
    }
    // Reaching the exact allowance is conservative: do not perform an uncharged
    // lookahead to upgrade a physically scanned prefix to a closed inventory.
    if (scannedRows === maxRows) { truncated = true; break; }
  }
  if (truncated) closures = new Map([...closures].map(([ref, closure]) => [ref,
    { ...closure, declarationsClosed: false, parentClosed: false }]));
  const answer = resolveCanonicalLexicalBinding({ partitions: [{ partitionId, records }],
    closures, annotations, world, profile, query, maxVisits, maxCandidates, maxWitnessRefs, signal });
  if (truncated) answer.frontier.push({ reason: 'retained-input-row-budget', scope: structuredClone(query.startScope) });
  const witness = (ref, record) => ({ ref: structuredClone(ref), sourceUnitId: captured.source.sourceUnitId,
    sourceHash: captured.source.byteHash, path: captured.source.path, coordinateUnit: 'utf16', span: [...record.span] });
  const result = { ...answer, sourceWitnesses: [witness(query.occurrence, occurrence), ...answer.targets.map(ref => witness(ref, declarations.get(key(ref))))],
    projection: { kind: 'retained-canonical-lexical/v1', partitionId, storeScope: store.cursorScope || null,
      scannedRows, retainedMetadataBytes, sourceReadBytes: captured.bytes.length, truncated,
      inputInventoryHash: semanticHash('semantic.retained-lexical-input.v1', { sourceSnapshotId, records }),
      profileAnnotations: 'trusted-upstream-admission', sourceLanguageClosure: 'not-implied', editAuthority: 'none' } };
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
