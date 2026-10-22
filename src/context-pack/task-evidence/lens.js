import { semanticHash, canonicalSemanticJson } from '../../index/semantic/identity.js';
import { readSemanticSourceCapability } from '../../index/semantic/source-capability.js';
import { selectDiverseEvidence } from '../../retrieval/pipeline/evidence-selection.js';
import { enforceContextPackResponseBudget } from '../response-budget.js';

const key = canonicalSemanticJson;
const boundary = (text, offset) => offset === 0 || offset === text.length
  || !(text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff
    && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);

/** Pure exact-source projection over the caller's admitted retrieval selection. */
export const materializeTaskLens = ({ worldRef, taskId, requiredRoles = [], maxFacets = 12,
  candidates, sources, retainedResult }) => {
  if (typeof taskId !== 'string' || !taskId.length || !worldRef || !Array.isArray(requiredRoles)
    || requiredRoles.some(role => typeof role !== 'string') || requiredRoles.length > 64
    || !Array.isArray(candidates) || candidates.length > 4096 || !Array.isArray(sources) || sources.length > 256
    || !Number.isSafeInteger(maxFacets) || maxFacets < 1 || maxFacets > 64
    || !retainedResult?.ownerHandle) throw new TypeError('Bounded admitted source lens inputs required.');
  const sourceMap = new Map();
  let sourceBytes = 0;
  for (const snapshot of sources) {
    const source = readSemanticSourceCapability(snapshot.sourceCapability);
    if (!source || snapshot.manifest?.byteHash !== source.byteHash || snapshot.manifest.textHash !== source.byteHash
      || snapshot.manifest.coordinateUnit !== 'utf16' || sourceMap.has(snapshot.manifest.sourceUnitId)) {
      throw new TypeError('Owned immutable source snapshots required.');
    }
    sourceBytes += source.byteLength;
    if (sourceBytes > 8 * 1024 * 1024) throw new RangeError('Lens source hydration allowance exceeded.');
    sourceMap.set(snapshot.manifest.sourceUnitId, { ...source, manifest: snapshot.manifest });
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
