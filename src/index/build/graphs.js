import Graph from 'graphology';
import { resolveChunkId } from '../chunk-id.js';

const GRAPH_MAX_NODES = 200000;
const GRAPH_MAX_EDGES = 500000;
const GRAPH_SAMPLE_LIMIT = 5;

const buildLegacyChunkKey = (chunk) => `${chunk.file}::${chunk.name}`;

const recordGraphSample = (guard, context) => {
  if (!guard || !context) return;
  if (guard.samples.length >= GRAPH_SAMPLE_LIMIT) return;
  guard.samples.push({
    file: context.file || null,
    chunkId: context.chunkId || null
  });
};

const createGraphGuard = (label) => ({
  label,
  maxNodes: GRAPH_MAX_NODES,
  maxEdges: GRAPH_MAX_EDGES,
  disabled: false,
  reason: null,
  samples: []
});

const mergeNode = (graph, id, attrs, guard, context) => {
  if (!id || guard?.disabled) return;
  if (!graph.hasNode(id)) {
    if (guard?.maxNodes && graph.order >= guard.maxNodes) {
      guard.disabled = true;
      guard.reason = 'max-nodes';
      recordGraphSample(guard, context);
      return;
    }
    graph.addNode(id, attrs);
    return;
  }
  graph.mergeNodeAttributes(id, attrs);
};

const addDirectedEdge = (graph, source, target, guard, context) => {
  if (!source || !target || guard?.disabled) return;
  if (guard?.maxEdges && graph.size >= guard.maxEdges) {
    guard.disabled = true;
    guard.reason = 'max-edges';
    recordGraphSample(guard, context);
    return;
  }
  mergeNode(graph, source, {}, guard, context);
  mergeNode(graph, target, {}, guard, context);
  if (guard?.disabled) return;
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
  const callGuard = createGraphGuard('callGraph');
  const usageGuard = createGraphGuard('usageGraph');
  const importGuard = createGraphGuard('importGraph');
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
    const context = { file: chunk.file, chunkId: chunkId || chunk.metaV2?.chunkId || null };
    const attrs = {
      file: chunk.file,
      name: chunk.name,
      kind: chunk.kind || null,
      chunkId: chunkId || null,
      legacyKey
    };
    mergeNode(callGraph, nodeId, attrs, callGuard, context);
    mergeNode(usageGraph, nodeId, attrs, usageGuard, context);
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
    const context = { file: chunk.file, chunkId: resolveChunkId(chunk) || null };
    const relations = chunk.codeRelations || {};
    if (Array.isArray(relations.callLinks)) {
      for (const link of relations.callLinks) {
        const targetKey = resolveNodeId(link?.file, link?.target);
        if (!targetKey) continue;
        mergeNode(callGraph, targetKey, resolveNodeAttrs(targetKey, {
          file: link.file || null,
          name: link.target || null,
          kind: link.kind || null
        }), callGuard, context);
        addDirectedEdge(callGraph, sourceKey, targetKey, callGuard, context);
        if (callGuard.disabled) break;
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
        }), usageGuard, context);
        addDirectedEdge(usageGraph, sourceKey, targetKey, usageGuard, context);
        if (usageGuard.disabled) break;
      }
    }
  }

  if (fileRelations && typeof fileRelations.entries === 'function') {
    for (const [file, relations] of fileRelations.entries()) {
      if (!file) continue;
      const context = { file, chunkId: null };
      mergeNode(importGraph, file, { file }, importGuard, context);
      const imports = Array.isArray(relations?.importLinks) ? relations.importLinks : [];
      for (const target of imports) {
        if (!target) continue;
        mergeNode(importGraph, target, { file: target }, importGuard, context);
        addDirectedEdge(importGraph, file, target, importGuard, context);
        if (importGuard.disabled) break;
      }
      if (importGuard.disabled) break;
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    callGraph: serializeGraph(callGraph),
    usageGraph: serializeGraph(usageGraph),
    importGraph: serializeGraph(importGraph),
    caps: {
      callGraph: callGuard.reason ? callGuard : null,
      usageGraph: usageGuard.reason ? usageGuard : null,
      importGraph: importGuard.reason ? importGuard : null
    }
  };
}
