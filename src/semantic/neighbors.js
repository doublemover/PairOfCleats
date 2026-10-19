import { canonicalSemanticJson } from '../index/semantic/identity.js';
import { SEMANTIC_EDGE_KINDS } from '../contracts/schemas/semantic.js';
/** Offset counts incident rows, including filtered rows; each call reads at most limit rows. */
export const createNeighborReader = getRelatedPage => {
  const read = async (ref, direction, kinds, options = {}) => {
    if (!['upstream', 'downstream'].includes(direction) || !Array.isArray(kinds) || !kinds.length || kinds.some(kind => !SEMANTIC_EDGE_KINDS.includes(kind))) throw new TypeError('Invalid semantic neighbor request.');
    const page = await getRelatedPage(ref, 'semantic_edges', options);
    const endpoint = direction === 'downstream' ? 'from' : 'to';
    const identity = canonicalSemanticJson(ref);
    const entries = page.rows.map((row, index) => ({
      edge: kinds.includes(row.kind) && canonicalSemanticJson(row[endpoint]) === identity ? row : null,
      offset: (options.offset || 0) + index + 1
    }));
    return { edges: entries.map(entry => entry.edge).filter(Boolean), entries, offset: page.offset, done: page.done };
  };
  // Trace can consume an incident-row batch without losing filtered-row cursor
  // positions. Test/custom readers without this capability retain one-row reads.
  read.supportsPositions = true;
  return read;
};
