import { canonicalSemanticJson } from '../index/semantic/identity.js';
import { SEMANTIC_EDGE_KINDS } from '../contracts/schemas/semantic.js';
/** Offset counts incident rows, including filtered rows; each call reads at most limit rows. */
export const createNeighborReader = getRelatedPage => async (ref, direction, kinds, options = {}) => {
  if (!['upstream', 'downstream'].includes(direction) || !Array.isArray(kinds) || !kinds.length || kinds.some(kind => !SEMANTIC_EDGE_KINDS.includes(kind))) throw new TypeError('Invalid semantic neighbor request.');
  const page = await getRelatedPage(ref, 'semantic_edges', options);
  const endpoint = direction === 'downstream' ? 'from' : 'to';
  const edges = page.rows.filter(row => kinds.includes(row.kind) && canonicalSemanticJson(row[endpoint]) === canonicalSemanticJson(ref));
  return { edges, offset: page.offset, done: page.done };
};
