import { semanticHash, canonicalSemanticJson } from '../../index/semantic/identity.js';
import { admitOwnedSemanticSourceSnapshot } from '../../index/semantic/source-snapshot-admission.js';
import { selectDiverseEvidence } from '../../retrieval/pipeline/evidence-selection.js';
import { enforceContextPackResponseBudget } from '../response-budget.js';
import { readRetainedSemanticSourceSnapshot } from '../../semantic/retained-source-snapshot.js';
import { assertSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';
import { validateSemanticRecord } from '../../contracts/validators/semantic.js';
import { throwIfAborted } from '../../shared/abort.js';

const key = canonicalSemanticJson;
const pinLensMetadata = value => {
  const encoded = key(value);
  if (Buffer.byteLength(encoded) > 4 * 1024 * 1024) throw new RangeError('Lens retained metadata allowance exceeded.');
  return JSON.parse(encoded);
};
const boundary = (text, offset) => offset === 0 || offset === text.length
  || !(text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
    && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);

/** Pure exact-source projection over the caller's admitted retrieval selection. */
export const materializeTaskLens = ({ worldRef, taskId, requiredRoles = [], maxFacets = 12,
  candidates, sources, retainedResult }) => {
  if (typeof taskId !== 'string' || !taskId.length || !worldRef || !Array.isArray(requiredRoles)
    || requiredRoles.length > 64
    || !Array.isArray(candidates) || candidates.length > 4096 || !Array.isArray(sources) || sources.length > 256
    || Object.keys(sources).length !== sources.length || Object.getOwnPropertySymbols(sources).length
    || !Number.isSafeInteger(maxFacets) || maxFacets < 1 || maxFacets > 64
    || !retainedResult) throw new TypeError('Bounded admitted source lens inputs required.');
  ({ worldRef, taskId, requiredRoles, candidates, retainedResult } = pinLensMetadata({ worldRef, taskId, requiredRoles, candidates, retainedResult }));
  if (requiredRoles.some(role => typeof role !== 'string') || !retainedResult.ownerHandle) {
    throw new TypeError('Bounded admitted source lens inputs required.');
  }
  const sourceMap = new Map();
  let sourceBytes = 0;
  for (let index = 0; index < sources.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(sources, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Owned source snapshot array data fields required.');
    const snapshot = descriptor.value;
    const source = admitOwnedSemanticSourceSnapshot(snapshot);
    if (sourceMap.has(source.manifest.sourceUnitId)) {
      throw new TypeError('Owned immutable source snapshots required.');
    }
    sourceBytes += source.byteLength;
    if (sourceBytes > 8 * 1024 * 1024) throw new RangeError('Lens source hydration allowance exceeded.');
    sourceMap.set(source.manifest.sourceUnitId, source);
  }
  const ids = new Set();
  const entries = candidates.map(candidate => {
    const source = sourceMap.get(candidate.sourceRef?.sourceUnitId), span = candidate.sourceRef?.span;
    if (!source || typeof candidate.id !== 'string' || ids.has(candidate.id) || !Number.isFinite(candidate.score)
      || !Array.isArray(candidate.roles) || !candidate.roles.length || candidate.roles.length > 64
      || candidate.roles.some(role => typeof role !== 'string') || key(candidate.worldRef) !== key(worldRef)
      || candidate.sourceRef.coordinateUnit !== 'utf16'
      || !Array.isArray(span) || span.length !== 2 || span.some(offset => !Number.isSafeInteger(offset) || offset < 0)
      || span[1] < span[0] || span[1] > source.text.length || !span.every(offset => boundary(source.text, offset))) {
      throw new TypeError('Incompatible lens evidence identity or UTF-16 source span.');
    }
    ids.add(candidate.id);
    return { ...candidate, chunk: { file: source.manifest.path, start: span[0], end: span[1] } };
  });
  // Preserve caller ranking and mandatory membership; use the existing diversity owner for optional previews.
  const mandatory = entries.filter(entry => entry.mandatory === true);
  const optional = entries.filter(entry => entry.mandatory !== true);
  const chosen = mandatory.length > maxFacets ? [] : mandatory.concat(
    selectDiverseEvidence(optional, Math.max(0, maxFacets - mandatory.length)));
  const selectionSetId = semanticHash('pairofcleats.task-lens-selection.v1', {
    worldRef, taskId, candidates: entries.map(entry => ({ id: entry.id, sourceRef: entry.sourceRef, roles: entry.roles })),
    retainedResult
  });
  const facets = chosen.map(entry => {
    const source = sourceMap.get(entry.sourceRef.sourceUnitId);
    return { facetId: entry.id, kind: entry.kind || 'source', sourceRef: structuredClone(entry.sourceRef),
      observationId: entry.observationId || entry.id, roles: [...entry.roles],
      representationKind: 'exactSource', text: source.text.slice(...entry.sourceRef.span),
      worldRef: structuredClone(worldRef), qualification: structuredClone(entry.qualification || { certainty: 'heuristic', closure: 'unknown' }),
      whyIncluded: entry.reason || 'Source candidate selected by the admitted retrieval owner.',
      expandToSource: { ownerHandle: retainedResult.ownerHandle, sourceRef: structuredClone(entry.sourceRef) },
      editAuthority: 'not-granted' };
  });
  const presentRoles = new Set(facets.flatMap(facet => facet.roles));
  let payload = { schemaVersion: 1, taskId, worldRef: structuredClone(worldRef), selectionSetId,
    presentationId: semanticHash('pairofcleats.task-lens-presentation.v1', { selectionSetId, maxFacets, representation: 'exact-source-v1' }),
    facets, retainedResult: structuredClone(retainedResult), totalCandidates: entries.length,
    omittedCandidates: entries.length - facets.length, missingRoles: requiredRoles.filter(role => !presentRoles.has(role)),
    status: mandatory.length > maxFacets ? 'mandatoryOverflow' : 'projected',
    completeness: 'not-implied', sourceBytesHydrated: sourceBytes, renderedBytes: Number.MAX_SAFE_INTEGER };
  const measure = value => Buffer.byteLength(JSON.stringify(value) + '\n');
  try { enforceContextPackResponseBudget(payload, { measure }); }
  catch (error) {
    if (error.code !== 'ERR_CONTEXT_PACK_RESPONSE_BUDGET') throw error;
    payload = { ...payload, facets: [], omittedCandidates: entries.length, missingRoles: [...requiredRoles],
      status: 'mandatoryOverflow', overflowReason: 'exact-source-response-budget' };
    delete payload.warnings;
    enforceContextPackResponseBudget(payload, { measure });
  }
  // The counter is part of the final serialized payload; settle its decimal-width contribution.
  let size = measure(payload);
  while (payload.renderedBytes !== size) { payload.renderedBytes = size; size = measure(payload); }
  enforceContextPackResponseBudget(payload, { measure });
  return payload;
};

/** Existing semantic records are the source admission boundary for this lens.
 * Roles and ranking remain caller declarations; source IDs/spans come only from
 * the pinned records. This grants no binding, edit or execution authority. */
export const materializeRetainedSemanticTaskLens = async ({ store, worldRef, taskId,
  requiredRoles = [], maxFacets = 12, candidates, retainedResult,
  maxSourceBytes = 8 * 1024 * 1024, signal = null }) => {
  throwIfAborted(signal);
  if (store?.backend !== 'artifact' || !worldRef || !Array.isArray(candidates) || candidates.length > 64
    || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1024 || maxSourceBytes > 8 * 1024 * 1024) {
    throw new TypeError('Bounded generation-pinned semantic lens required.');
  }
  ({ worldRef, taskId, requiredRoles, candidates, retainedResult } = pinLensMetadata({ worldRef, taskId, requiredRoles, candidates, retainedResult }));
  if (key(assertSemanticEnvelope('generation', worldRef.generation)) !== key(store.generation)
    || typeof worldRef.repositoryNamespace !== 'string' || !worldRef.repositoryNamespace
    || !Array.isArray(requiredRoles) || requiredRoles.length > 64 || requiredRoles.some(role => typeof role !== 'string')
    || typeof taskId !== 'string' || !taskId || !retainedResult?.ownerHandle
    || !Number.isSafeInteger(maxFacets) || maxFacets < 1 || maxFacets > 64
    || candidates.some(candidate => !validateSemanticRecord('recordRef', candidate?.ref).ok)) {
    throw new TypeError('Bounded generation-pinned semantic lens required.');
  }
  let metadataBytes = Buffer.byteLength(key({ worldRef, taskId, requiredRoles, candidates, retainedResult }));
  const retain = value => {
    const encoded = key(value); metadataBytes += Buffer.byteLength(encoded);
    if (metadataBytes > 4 * 1024 * 1024) throw new RangeError('Lens retained metadata allowance exceeded.');
    return JSON.parse(encoded);
  };
  const rows = await store.getRecords(candidates.map(candidate => candidate.ref), ['span'], { signal });
  throwIfAborted(signal);
  if (!Array.isArray(rows) || rows.length !== candidates.length) throw new TypeError('Retained lens source inventory is incomplete.');
  const records = retain(rows);
  const snapshots = new Map(), byPartition = new Map();
  let bytes = 0;
  const projected = [];
  for (let index = 0; index < candidates.length; index++) {
    throwIfAborted(signal);
    const candidate = candidates[index], record = records[index];
    if (!record || key(record.ref) !== key(candidate.ref) || !record.span) throw new TypeError('Retained lens source record is unavailable.');
    let source = byPartition.get(record.ref.partitionId);
    if (!source) {
      const remaining = maxSourceBytes - bytes;
      if (remaining < 1) throw new RangeError('Retained lens source allowance exceeded.');
      const captured = await readRetainedSemanticSourceSnapshot({ store, partitionId: record.ref.partitionId,
        repositoryNamespace: worldRef.repositoryNamespace, maxBytes: remaining, signal });
      source = captured.source;
      retain(source);
      if (source.mapping !== null) throw Object.assign(new Error('Retained lens needs an independently qualified original-source mapping.'), {
        code: 'ERR_SEMANTIC_SOURCE_MAPPING_UNAVAILABLE'
      });
      bytes += captured.bytes.length;
      if (snapshots.has(source.sourceUnitId) && key(snapshots.get(source.sourceUnitId).manifest) !== key(source)) {
        throw new TypeError('Conflicting retained lens source manifests.');
      }
      snapshots.set(source.sourceUnitId, captured.snapshot);
      byPartition.set(record.ref.partitionId, source);
    }
    projected.push({ ...candidate, worldRef, sourceRef: { sourceUnitId: source.sourceUnitId,
      span: record.span, coordinateUnit: source.coordinateUnit },
    qualification: { certainty: 'exact-retained-source', closure: 'not-implied' } });
  }
  throwIfAborted(signal);
  const result = materializeTaskLens({ worldRef, taskId, requiredRoles, maxFacets,
    candidates: projected, sources: [...snapshots.values()], retainedResult });
  throwIfAborted(signal);
  return result;
};
