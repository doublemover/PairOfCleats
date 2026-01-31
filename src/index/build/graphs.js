import Graph from 'graphology';
import { compareStrings } from '../../shared/sort.js';
import { resolveChunkId } from '../chunk-id.js';

const GRAPH_MAX_NODES = 200000;
const GRAPH_MAX_EDGES = 500000;
const GRAPH_SAMPLE_LIMIT = 5;

const buildLegacyChunkKey = (chunk) => {
  if (!chunk?.file || !chunk?.name) return null;
  return `${chunk.file}::${chunk.name}`;
};
const resolveChunkUid = (chunk) => chunk?.chunkUid || chunk?.metaV2?.chunkUid || null;

const recordGraphSample = (guard, context) => {
  if (!guard || !context) return;
  if (guard.samples.length >= GRAPH_SAMPLE_LIMIT) return;
  guard.samples.push({
    file: context.file || null,
    chunkId: context.chunkId || null,
    chunkUid: context.chunkUid || null
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
  nodes.sort((a, b) => compareStrings(a.id, b.id));
  return {
    nodeCount: graph.order,
    edgeCount: graph.size,
    nodes
  };
};

export function buildRelationGraphs({ chunks = [], fileRelations = null, callSites = null } = {}) {
  const callGraph = new Graph({ type: 'directed' });
  const usageGraph = new Graph({ type: 'directed' });
  const importGraph = new Graph({ type: 'directed' });
  const callGuard = createGraphGuard('callGraph');
  const usageGuard = createGraphGuard('usageGraph');
  const importGuard = createGraphGuard('importGraph');
  const chunkByUid = new Map();

  for (const chunk of chunks) {
    if (!chunk?.file) continue;
    const legacyKey = buildLegacyChunkKey(chunk);
    const chunkId = resolveChunkId(chunk);
    const chunkUid = resolveChunkUid(chunk);
    if (!chunkUid) continue;
    chunkByUid.set(chunkUid, chunk);
    const context = {
      file: chunk.file,
      chunkId: chunkId || chunk.metaV2?.chunkId || null,
      chunkUid
    };
    const attrs = {
      file: chunk.file,
      name: chunk.name,
      kind: chunk.kind || null,
      chunkId: chunkId || null,
      chunkUid: chunkUid || null,
      legacyKey,
      symbolId: chunk.metaV2?.symbol?.symbolId || null
    };
    mergeNode(callGraph, chunkUid, attrs, callGuard, context);
    mergeNode(usageGraph, chunkUid, attrs, usageGuard, context);
  }

  const callSiteEdges = [];
  if (Array.isArray(callSites) && callSites.length) {
    for (const site of callSites) {
      if (!site?.callerChunkUid || !site?.targetChunkUid) continue;
      callSiteEdges.push({ source: site.callerChunkUid, target: site.targetChunkUid });
    }
  } else {
    for (const chunk of chunks) {
      const callerUid = resolveChunkUid(chunk);
      if (!callerUid) continue;
      const relations = chunk.codeRelations || {};
      if (!Array.isArray(relations.callDetails)) continue;
      for (const detail of relations.callDetails) {
        if (!detail?.targetChunkUid) continue;
        callSiteEdges.push({ source: callerUid, target: detail.targetChunkUid });
      }
    }
  }

  for (const chunk of chunks) {
    if (!chunk?.file) continue;
    const sourceKey = resolveChunkUid(chunk);
    if (!sourceKey || !chunkByUid.has(sourceKey)) continue;
    const context = {
      file: chunk.file,
      chunkId: resolveChunkId(chunk) || null,
      chunkUid: resolveChunkUid(chunk) || null
    };
    const relations = chunk.codeRelations || {};
    if (Array.isArray(relations.callLinks)) {
      for (const link of relations.callLinks) {
        const targetUid = link?.to?.status === 'resolved' ? link.to.resolved?.chunkUid : null;
        if (!targetUid || !chunkByUid.has(targetUid)) continue;
        addDirectedEdge(callGraph, sourceKey, targetUid, callGuard, context);
        if (callGuard.disabled) break;
      }
    }
    if (Array.isArray(relations.usageLinks)) {
      for (const link of relations.usageLinks) {
        const targetUid = link?.to?.status === 'resolved' ? link.to.resolved?.chunkUid : null;
        if (!targetUid || !chunkByUid.has(targetUid)) continue;
        addDirectedEdge(usageGraph, sourceKey, targetUid, usageGuard, context);
        if (usageGuard.disabled) break;
      }
    }
  }

  if (callSiteEdges.length) {
    for (const edge of callSiteEdges) {
      const sourceKey = edge.source;
      const targetKey = edge.target;
      if (!sourceKey || !targetKey) continue;
      if (!chunkByUid.has(sourceKey) || !chunkByUid.has(targetKey)) continue;
      const sourceChunk = chunkByUid.get(edge.source) || null;
      const context = {
        file: sourceChunk?.file || null,
        chunkId: resolveChunkId(sourceChunk) || null,
        chunkUid: edge.source
      };
      addDirectedEdge(callGraph, sourceKey, targetKey, callGuard, context);
      if (callGuard.disabled) break;
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
    version: 2,
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
