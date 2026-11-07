import { GRAPH_NAMES, normalizeEdgeFilter } from './neighborhood/filter.js';

const orientation = Object.freeze({ callGraph: 'caller-to-callee', usageGraph: 'user-to-used-target',
  importGraph: 'importer-to-imported-file', symbolEdges: 'source-reference-to-symbol' });

/** Product dependency direction is distinct from canonical edge direction. New
 * relation families must declare their orientation before entering impact. */
export const resolveImpactDirection = (value, edgeFilters = null) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const requested = ['upstream', 'downstream', 'both'].includes(normalized) ? normalized : 'downstream';
  const graphs = [...(normalizeEdgeFilter(edgeFilters).graphs || GRAPH_NAMES)].filter(graph => GRAPH_NAMES.has(graph));
  if (graphs.some(graph => !Object.hasOwn(orientation, graph))) throw new TypeError('Impact relation requires an explicit dependency orientation.');
  return Object.freeze({ policyVersion: 1, requested, traversal: requested === 'both' ? 'both' : requested === 'downstream' ? 'in' : 'out',
    meaning: requested === 'downstream' ? 'recorded-dependents' : requested === 'upstream' ? 'recorded-dependencies' : 'both-recorded-directions',
    relationOrientation: Object.freeze(Object.fromEntries(graphs.map(graph => [graph, orientation[graph]]))) });
};
