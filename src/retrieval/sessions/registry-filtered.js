import { openFilteredStoredVectorSession } from './filtered-stored.js';
import { eligibleRegistryRows, resolveVectorPlacement } from '../vector-generation/live-registry.js';

/** Candidate placement receipts are checked before exposing numeric rows to the existing exact rescue owner. */
export const openRegistryFilteredVectorSession = ({ registry, eligibleIds, probe = null, ...input }) => {
  const descriptor = registry?.descriptor;
  if (!descriptor || ['repositoryId', 'generationId', 'rowMapId', 'representationId'].some(name => descriptor[name] !== input.target?.[name])
    || descriptor.dimension !== input.idx?.denseVec?.dims || descriptor.metric !== 'dot'
    || probe !== null && typeof probe !== 'function') throw new TypeError('Compatible pinned registry and stored-dot session required.');
  const eligibleRows = eligibleRegistryRows(registry, eligibleIds);
  const rejected = { stale: 0, deleted: 0, malformed: 0 };
  const qualifiedProbe = probe && (async request => {
    const response = await probe(request);
    if (!Array.isArray(response?.placements) || response.placements.length > request.maxWork) throw new TypeError('Bounded incarnation-bearing probe required.');
    const ids = [];
    for (const placement of response.placements) {
      const result = resolveVectorPlacement(registry, placement);
      if (result.status === 'live') ids.push(result.rowId);
      else if (result.reason === 'logically-deleted') rejected.deleted++;
      else if (result.reason === 'unqualified-placement') rejected.malformed++;
      else rejected.stale++;
    }
    return { ids, actualWork: response.actualWork };
  });
  const session = openFilteredStoredVectorSession({ ...input, eligibleRows, probe: qualifiedProbe });
  return Object.freeze({ ...session, registryRoot: registry.rootId, placementRejections: () => ({ ...rejected }) });
};
