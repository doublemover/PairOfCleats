import { validateArtifact } from '../contracts/artifact-schemas.js';
import { createRetainedEvidencePages } from './retained-evidence-pages.js';

const GRAPHS = new Set(['callGraph', 'usageGraph', 'importGraph']);
const normalizeFilter = filter => {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)
    || Object.keys(filter).some(key => !['graph', 'from', 'to', 'node', 'direction'].includes(key))) {
    throw new TypeError('Unknown retained adjacency filter.');
  }
  const output = {};
  for (const key of ['graph', 'from', 'to', 'node']) {
    if (filter[key] == null) { output[key] = null; continue; }
    if (typeof filter[key] !== 'string' || !filter[key] || filter[key].length > 4096) throw new TypeError('Invalid retained adjacency identity.');
    output[key] = filter[key];
  }
  if (output.graph && !GRAPHS.has(output.graph)) throw new TypeError('Unknown retained adjacency graph.');
  output.direction = filter.direction ?? 'both';
  if (!['out', 'in', 'both'].includes(output.direction) || !output.node && output.direction !== 'both') {
    throw new TypeError('Directional adjacency queries require a node identity.');
  }
  return output;
};
const matches = (row, filter) => (!filter.graph || row.graph === filter.graph)
  && (!filter.from || row.from === filter.from) && (!filter.to || row.to === filter.to)
  && (!filter.node || filter.direction !== 'in' && row.from === filter.node
    || filter.direction !== 'out' && row.to === filter.node);

/** Unique retained resolved adjacency, independent of capped display graphs. */
export const createRetainedEdgePages = options => createRetainedEvidencePages({ ...options,
  family: 'graph_relation_edges', ordering: 'graph-from-to-v1', errorPrefix: 'GRAPH_EDGE',
  normalizeFilter, matches,
  validateRow: row => validateArtifact('graph_relation_edges', [row]).ok
});
