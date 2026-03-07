import { MAX_GRAPH_NODES } from './constants.js';

export const addGraphNode = (nodes, id, type, stats) => {
  if (nodes.has(id)) return;
  if (nodes.size >= MAX_GRAPH_NODES) {
    if (stats) stats.truncatedNodes += 1;
    return;
  }
  nodes.set(id, { id, type });
};

export const buildEdgeSortKey = (edge) => [
  edge?.from || '',
  edge?.to || '',
  edge?.rawSpecifier || '',
  edge?.resolvedType || '',
  edge?.resolvedPath || '',
  edge?.packageName || '',
  edge?.tsconfigPath || '',
  edge?.tsPathPattern || ''
].join('|');

export const buildWarningSortKey = (warning) => (
  [
    warning?.importer || '',
    warning?.specifier || '',
    warning?.reasonCode || '',
    warning?.reason || ''
  ].join('|')
);
