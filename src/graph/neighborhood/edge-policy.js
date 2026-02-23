import { edgeKey } from '../ordering.js';

export const isEdgeBetter = (candidate, current) => {
  if (!current) return true;
  const candConf = Number.isFinite(candidate?.confidence) ? candidate.confidence : null;
  const currConf = Number.isFinite(current?.confidence) ? current.confidence : null;
  if (candConf != null && currConf != null && candConf !== currConf) {
    return candConf > currConf;
  }
  if (candConf != null && currConf == null) return true;
  if (candConf == null && currConf != null) return false;
  const candEvidence = candidate?.evidence && Object.keys(candidate.evidence).length > 0;
  const currEvidence = current?.evidence && Object.keys(current.evidence).length > 0;
  if (candEvidence !== currEvidence) return candEvidence;
  return false;
};

export const dedupeSortedEdges = (sortedEdges) => {
  if (!Array.isArray(sortedEdges) || sortedEdges.length <= 1) return sortedEdges || [];
  const deduped = [];
  let lastKey = null;
  let best = null;
  for (const edge of sortedEdges) {
    const key = edgeKey(edge);
    if (key !== lastKey) {
      if (best) deduped.push(best);
      best = edge;
      lastKey = key;
      continue;
    }
    if (isEdgeBetter(edge, best)) best = edge;
  }
  if (best) deduped.push(best);
  return deduped;
};

export const edgeKeyFromIndex = (edge, index, normalizeImport) => {
  if (!edge || typeof edge !== 'object' || !edge.graph || !index) return edgeKey(edge);
  const graphName = edge.graph;
  if (graphName === 'callGraph') {
    const fromId = index.callGraphIds?.idToIndex?.get(edge.from?.chunkUid || '');
    const toId = index.callGraphIds?.idToIndex?.get(edge.to?.chunkUid || '');
    if (fromId != null && toId != null) {
      return `callGraph|${fromId}|${edge.edgeType || ''}|${toId}`;
    }
    return edgeKey(edge);
  }
  if (graphName === 'usageGraph') {
    const fromId = index.usageGraphIds?.idToIndex?.get(edge.from?.chunkUid || '');
    const toId = index.usageGraphIds?.idToIndex?.get(edge.to?.chunkUid || '');
    if (fromId != null && toId != null) {
      return `usageGraph|${fromId}|${edge.edgeType || ''}|${toId}`;
    }
    return edgeKey(edge);
  }
  if (graphName === 'importGraph') {
    const fromPath = normalizeImport(edge.from?.path) || edge.from?.path || '';
    const toPath = normalizeImport(edge.to?.path) || edge.to?.path || '';
    const fromId = index.importGraphIds?.idToIndex?.get(fromPath);
    const toId = index.importGraphIds?.idToIndex?.get(toPath);
    if (fromId != null && toId != null) {
      return `importGraph|${fromId}|${edge.edgeType || ''}|${toId}`;
    }
    return edgeKey(edge);
  }
  return edgeKey(edge);
};
