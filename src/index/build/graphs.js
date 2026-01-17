import Graph from 'graphology';
import { resolveChunkId } from '../chunk-id.js';

const buildLegacyChunkKey = (chunk) => `${chunk.file}::${chunk.name}`;

const mergeNode = (graph, id, attrs) => {
  if (!id) return;
  if (graph.hasNode(id)) {
    graph.mergeNodeAttributes(id, attrs);
  } else {
    graph.addNode(id, attrs);
  }
};

const addDirectedEdge = (graph, source, target) => {
  if (!source || !target) return;
  mergeNode(graph, source, {});
  mergeNode(graph, target, {});
  graph.mergeEdge(source, target);
};

const serializeGraph = (graph) => {
  const nodes = [];
  graph.forEachNode((id, attrs) => {
    const out = graph.outNeighbors(id).slice().sort();
    const incoming = graph.inNeighbors(id).slice().sort();
    nodes.push({
      id,
      ...attrs,
      out,
      in: incoming
    });
  });
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  return {
    nodeCount: graph.order,
    edgeCount: graph.size,
    nodes
  };
};

export function buildRelationGraphs({ chunks = [], fileRelations = null } = {}) {
  const callGraph = new Graph({ type: 'directed' });
  const usageGraph = new Graph({ type: 'directed' });
  const importGraph = new Graph({ type: 'directed' });
  const chunkById = new Map();
  const chunkIdByKey = new Map();

  for (const chunk of chunks) {
    if (!chunk?.file || !chunk?.name) continue;
    const legacyKey = buildLegacyChunkKey(chunk);
    const chunkId = resolveChunkId(chunk);
    const nodeId = chunkId || legacyKey;
    if (!nodeId) continue;
    chunkById.set(nodeId, chunk);
    if (legacyKey) {
      chunkIdByKey.set(legacyKey, nodeId);
    }
    const attrs = {
      file: chunk.file,
      name: chunk.name,
      kind: chunk.kind || null,
      chunkId: chunkId || null,
      legacyKey
    };
    mergeNode(callGraph, nodeId, attrs);
    mergeNode(usageGraph, nodeId, attrs);
  }

  const resolveNodeId = (file, name) => {
    if (!file || !name) return null;
    const legacyKey = `${file}::${name}`;
    return chunkIdByKey.get(legacyKey) || legacyKey;
  };

  const resolveNodeAttrs = (nodeId, fallback) => {
    const chunk = chunkById.get(nodeId);
    if (!chunk) return fallback;
    const legacyKey = buildLegacyChunkKey(chunk);
    return {
      file: chunk.file,
      name: chunk.name,
      kind: chunk.kind || null,
      chunkId: resolveChunkId(chunk) || null,
      legacyKey
    };
  };

  for (const chunk of chunks) {
    if (!chunk?.file || !chunk?.name) continue;
    const legacyKey = buildLegacyChunkKey(chunk);
    const sourceKey = chunkIdByKey.get(legacyKey) || legacyKey;
    const relations = chunk.codeRelations || {};
    if (Array.isArray(relations.callLinks)) {
      for (const link of relations.callLinks) {
        const targetKey = resolveNodeId(link?.file, link?.target);
        if (!targetKey) continue;
        mergeNode(callGraph, targetKey, resolveNodeAttrs(targetKey, {
          file: link.file || null,
          name: link.target || null,
          kind: link.kind || null
        }));
        addDirectedEdge(callGraph, sourceKey, targetKey);
      }
    }
    if (Array.isArray(relations.usageLinks)) {
      for (const link of relations.usageLinks) {
        const targetKey = resolveNodeId(link?.file, link?.target);
        if (!targetKey) continue;
        mergeNode(usageGraph, targetKey, resolveNodeAttrs(targetKey, {
          file: link.file || null,
          name: link.target || null,
          kind: link.kind || null
        }));
        addDirectedEdge(usageGraph, sourceKey, targetKey);
      }
    }
  }

  if (fileRelations && typeof fileRelations.entries === 'function') {
    for (const [file, relations] of fileRelations.entries()) {
      if (!file) continue;
      mergeNode(importGraph, file, { file });
      const imports = Array.isArray(relations?.importLinks) ? relations.importLinks : [];
      for (const target of imports) {
        if (!target) continue;
        mergeNode(importGraph, target, { file: target });
        addDirectedEdge(importGraph, file, target);
      }
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    callGraph: serializeGraph(callGraph),
    usageGraph: serializeGraph(usageGraph),
    importGraph: serializeGraph(importGraph)
  };
}
