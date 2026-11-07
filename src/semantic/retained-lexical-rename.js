import { captureRetainedLexicalInputs, retainedLexicalInputError } from './retained-lexical-inputs.js';
import { projectCanonicalLexicalBindingInputs } from './lexical-binding.js';
import { proposeLexicalRename } from '../index/semantic/reference-repair/lexical-rename.js';
import { validateSemanticRecord } from '../contracts/validators/semantic.js';
import { canonicalSemanticJson, semanticHash } from '../index/semantic/identity.js';
import { throwIfAborted } from '../shared/abort.js';

const key = canonicalSemanticJson;
const text = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096;
const fail = retainedLexicalInputError;
const definitionOnly = record => record.data.roles.includes('definition')
  && record.data.roles.every(role => role === 'definition' || role === 'write');

/** One immutable syntax partition feeds the existing inert overlay planner.
 * Namespace/datum/access and closure remain trusted upstream profile admission;
 * this adapter neither infers whole-language closure nor applies an edit. */
export const proposeRetainedCanonicalLexicalRename = async ({ store, world, profile, closures, annotations,
  target, newName, occurrenceAnnotations, referenceUniverse = { state: 'partial' },
  maxRows = 16384, maxMetadataBytes = 4 * 1024 * 1024, maxSourceBytes = 8 * 1024 * 1024,
  maxQueries = 4096, maxVisits = 4096, maxCandidates = 128, maxWitnessRefs = 16384,
  maxEvidenceBytes = 4 * 1024 * 1024, signal = null }) => {
  throwIfAborted(signal);
  target = JSON.parse(key(target));
  if (!validateSemanticRecord('recordRef', target).ok || !target.partitionId.startsWith('sy1:')
    || !(occurrenceAnnotations instanceof Map) || occurrenceAnnotations.size > 16384) {
    throw fail('Bounded retained rename target and occurrence profile map required.');
  }
  const inputs = await captureRetainedLexicalInputs({ store, world, profile, closures, annotations,
    partitionId: target.partitionId, selection: { target, newName, referenceUniverse,
      occurrenceAnnotations: [...occurrenceAnnotations] }, maxRows, maxMetadataBytes, maxSourceBytes, signal });
  ({ target, newName, referenceUniverse } = inputs.selection);
  const declaration = inputs.byRef.get(key(target));
  if (!declaration || declaration.kind !== 'declaration' || !declaration.scope) {
    throw fail('The retained rename target declaration is unavailable in the admitted row inventory.');
  }
  const model = projectCanonicalLexicalBindingInputs({ partitions: [{ partitionId: target.partitionId, records: inputs.records }],
    closures: inputs.closures, annotations: inputs.annotations });
  const occurrenceMap = new Map();
  for (const [ref, annotation] of inputs.selection.occurrenceAnnotations) {
    let decoded;
    try { decoded = JSON.parse(ref); } catch { throw fail('Canonical occurrence profile map reference required.'); }
    const record = inputs.byRef.get(ref);
    if (typeof ref !== 'string' || !validateSemanticRecord('recordRef', decoded).ok || key(decoded) !== ref
      || decoded.partitionId !== target.partitionId || occurrenceMap.has(ref)
      || !record && !inputs.projection.truncated || record && (record.kind !== 'occurrence' || definitionOnly(record))
      || !annotation || Object.keys(annotation).length !== 2 || !Object.hasOwn(annotation, 'namespace')
      || !Object.hasOwn(annotation, 'datumKey') || !text(annotation.namespace) || !text(annotation.datumKey)) {
      throw fail('Occurrence profile annotations must identify captured reference records and an exact namespace/datum.');
    }
    occurrenceMap.set(ref, annotation);
  }
  const occurrences = [], frontier = [];
  const site = record => ({ sourceUnitId: inputs.captured.source.sourceUnitId, span: [...record.span] });
  let definitionOccurrences = 0, unqualifiedOccurrences = 0;
  for (const record of inputs.records) {
    throwIfAborted(signal);
    if (record.kind !== 'occurrence') continue;
    if (definitionOnly(record)) { definitionOccurrences++; continue; }
    const ref = { partitionId: target.partitionId, localId: record.id }, annotation = occurrenceMap.get(key(ref));
    if (!annotation || !record.scope) {
      unqualifiedOccurrences++;
      frontier.push({ reason: annotation ? 'retained-reference-scope-unavailable' : 'retained-reference-profile-unavailable', occurrence: ref });
      continue;
    }
    occurrences.push({ query: { occurrence: ref, startScope: record.scope,
      namespace: annotation.namespace, datumKey: annotation.datumKey }, site: site(record) });
    if (occurrences.length > 16384) throw fail('Retained rename preservation occurrence allowance exhausted.');
  }
  const occurrenceAnnotationsHash = semanticHash('semantic.retained-lexical-occurrence-profile.v1',
    [...occurrenceMap].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const universeQualified = referenceUniverse && Object.keys(referenceUniverse).length === 7
    && ['state', 'receiptId', 'world', 'partitionId', 'inputInventoryHash', 'profileHash', 'occurrenceAnnotationsHash']
      .every(name => Object.hasOwn(referenceUniverse, name))
    && referenceUniverse.state === 'complete-in-model' && text(referenceUniverse.receiptId)
    && key(referenceUniverse.world) === key(inputs.world) && referenceUniverse.partitionId === target.partitionId
    && referenceUniverse.inputInventoryHash === inputs.projection.inputInventoryHash
    && referenceUniverse.profileHash === inputs.projection.profileHash
    && referenceUniverse.occurrenceAnnotationsHash === occurrenceAnnotationsHash;
  if (inputs.projection.truncated) frontier.push({ reason: 'retained-input-row-budget' });
  if (!universeQualified) frontier.push({ reason: 'retained-reference-universe-unqualified' });
  const complete = universeQualified && !inputs.projection.truncated && unqualifiedOccurrences === 0;
  const plan = proposeLexicalRename({ ...model, world: inputs.world, profile: inputs.profile,
    target, declarationSite: site(declaration), newName, occurrences, sources: [inputs.captured.snapshot],
    referenceUniverse: complete ? { state: 'complete-in-model', receiptId: referenceUniverse.receiptId } : { state: 'partial' },
    maxQueries, maxVisits, maxCandidates, maxWitnessRefs, maxEvidenceBytes, maxSourceBytes, signal });
  plan.frontier.push(...frontier);
  if (plan.bindingPreservation === 'preserved-in-model' && frontier.length) plan.bindingPreservation = 'unknown';
  throwIfAborted(signal);
  return { ...plan, projection: { ...inputs.projection, kind: 'retained-canonical-lexical-rename/v1',
    retainedMetadataBytes: inputs.metadataBytes(), preservationOccurrences: occurrences.length,
    definitionOccurrences, unqualifiedOccurrences, occurrenceAnnotationsHash,
    referenceUniverse: complete ? 'trusted-upstream-admission-bound-to-capture' : 'partial-or-unqualified',
    syntaxReparse: 'not-run', nativeBindingValidation: 'not-run', sourceLanguageClosure: 'not-implied' } };
};
