import { buildGraphNodeIndex } from './indexes.js';

const prepared = new WeakMap();

/** Graph relations are immutable after generation admission; replacement invalidates this weak owner. */
export const resolveGraphNodeIndexes = (graphRelations, families = ['callGraph', 'usageGraph', 'importGraph']) => {
  if (!graphRelations || typeof graphRelations !== 'object') return null;
  let indexes = prepared.get(graphRelations);
  if (!indexes) {
    indexes = Object.create(null);
    prepared.set(graphRelations, indexes);
  }
  for (const family of families) {
    if (!indexes[family]) indexes[family] = buildGraphNodeIndex(graphRelations[family]);
  }
  return indexes;
};
