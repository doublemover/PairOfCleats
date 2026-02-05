import Graph from 'graphology';
import { normalizeCap } from '../../shared/limits.js';
import { stableOrder } from '../../shared/order.js';
import { resolveChunkId } from '../chunk-id.js';
import { resolveRelativeImport } from '../type-inference-crossfile/resolve-relative-import.js';

const GRAPH_MAX_NODES = 200000;
const GRAPH_MAX_EDGES = 500000;
const GRAPH_SAMPLE_LIMIT = 5;

const resolveCaps = (caps) => ({
  maxNodes: normalizeCap(caps?.maxNodes, GRAPH_MAX_NODES),
  maxEdges: normalizeCap(caps?.maxEdges, GRAPH_MAX_EDGES)
});

const resolveGraphCaps = (caps, label) => {
  if (!caps || typeof caps !== 'object') return resolveCaps(null);
  const perGraph = caps[label];
  if (perGraph && typeof perGraph === 'object') {
    return resolveCaps(perGraph);
  }
  return resolveCaps(caps);
};

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

const createGraphGuard = (label, caps) => ({
  label,
  maxNodes: caps?.maxNodes ?? GRAPH_MAX_NODES,
  maxEdges: caps?.maxEdges ?? GRAPH_MAX_EDGES,
  disabled: false,
  reason: null,
  cap: null,
  droppedNodes: 0,
  droppedEdges: 0,
  samples: []
});

const mergeNode = (graph, id, attrs, guard, context) => {
  if (!id) return;
  if (guard?.disabled) {
    if (guard.reason === 'maxNodes') guard.droppedNodes += 1;
    return;
  }
  if (!graph.hasNode(id)) {
    if (guard?.maxNodes != null && graph.order >= guard.maxNodes) {
      guard.disabled = true;
      guard.reason = 'maxNodes';
      guard.cap = 'maxNodes';
      guard.droppedNodes += 1;
      recordGraphSample(guard, context);
      return;
    }
    graph.addNode(id, attrs);
    return;
  }
  graph.mergeNodeAttributes(id, attrs);
};

const addDirectedEdge = (graph, source, target, guard, context) => {
  if (!source || !target) return;
  if (guard?.disabled) {
    if (guard.reason === 'maxEdges') guard.droppedEdges += 1;
    return;
  }
  if (guard?.maxEdges != null && graph.size >= guard.maxEdges) {
    guard.disabled = true;
    guard.reason = 'maxEdges';
    guard.cap = 'maxEdges';
    guard.droppedEdges += 1;
    recordGraphSample(guard, context);
    return;
  }
  mergeNode(graph, source, {}, guard, context);
  mergeNode(graph, target, {}, guard, context);
  if (guard?.disabled) return;
  graph.mergeEdge(source, target);
};

const serializeGraphNodes = (graph) => {
  const nodes = [];
  const ids = stableOrder(graph.nodes().slice(), [(id) => id]);
  for (const id of ids) {
    const attrs = graph.getNodeAttributes(id) || {};
    const out = stableOrder(graph.outNeighbors(id).slice(), [(value) => value]);
    const incoming = stableOrder(graph.inNeighbors(id).slice(), [(value) => value]);
    nodes.push({
      id,
      ...attrs,
      out,
      in: incoming
    });
  }
  return nodes;
};

const serializeGraph = (graph, { emitNodes = true } = {}) => {
  const nodes = emitNodes ? serializeGraphNodes(graph) : null;
  return {
    nodeCount: graph.order,
    edgeCount: graph.size,
    nodes
  };
};

/**
 * Build call/usage/import relation graphs from indexed chunks.
 * @param {object} input
 * @param {Array<object>} [input.chunks]
 * @param {Map<string,object>|null} [input.fileRelations]
 * @param {Array<object>|null} [input.callSites]
 * @param {object|null} [input.caps]
 * @returns {{version:number,generatedAt:string,callGraph:object,usageGraph:object,importGraph:object,caps:object}}
 */
export function buildRelationGraphs({
  chunks = [],
  fileRelations = null,
  callSites = null,
  caps = null,
  emitNodes = true
} = {}) {
  const callGraph = new Graph({ type: 'directed' });
  const usageGraph = new Graph({ type: 'directed' });
  const importGraph = new Graph({ type: 'directed' });
  const callGuard = createGraphGuard('callGraph', resolveGraphCaps(caps, 'callGraph'));
  const usageGuard = createGraphGuard('usageGraph', resolveGraphCaps(caps, 'usageGraph'));
  const importGuard = createGraphGuard('importGraph', resolveGraphCaps(caps, 'importGraph'));
  const chunkByUid = new Map();
  const fileSet = new Set();

  for (const chunk of chunks) {
    if (!chunk?.file) continue;
    fileSet.add(chunk.file);
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

  const appendCallSiteEdges = () => {
    if (Array.isArray(callSites) && callSites.length) {
      for (const site of callSites) {
        const sourceKey = site?.callerChunkUid;
        const targetKey = site?.targetChunkUid;
        if (!sourceKey || !targetKey) continue;
        if (!chunkByUid.has(sourceKey) || !chunkByUid.has(targetKey)) continue;
        const sourceChunk = chunkByUid.get(sourceKey) || null;
        const context = {
          file: sourceChunk?.file || null,
          chunkId: resolveChunkId(sourceChunk) || null,
          chunkUid: sourceKey
        };
        addDirectedEdge(callGraph, sourceKey, targetKey, callGuard, context);
        if (callGuard.disabled) break;
      }
      return;
    }
    for (const chunk of chunks) {
      const callerUid = resolveChunkUid(chunk);
      if (!callerUid) continue;
      const relations = chunk.codeRelations || {};
      if (!Array.isArray(relations.callDetails)) continue;
      const context = {
        file: chunk.file,
        chunkId: resolveChunkId(chunk) || null,
        chunkUid: callerUid
      };
      for (const detail of relations.callDetails) {
        const targetUid = detail?.targetChunkUid;
        if (!targetUid || !chunkByUid.has(targetUid)) continue;
        addDirectedEdge(callGraph, callerUid, targetUid, callGuard, context);
        if (callGuard.disabled) break;
      }
      if (callGuard.disabled) break;
    }
  };
  appendCallSiteEdges();

  if (fileRelations && typeof fileRelations.entries === 'function') {
    for (const [file, relations] of fileRelations.entries()) {
      if (!file) continue;
      const context = { file, chunkId: null };
      mergeNode(importGraph, file, { file }, importGuard, context);
      let imports = Array.isArray(relations?.importLinks) ? relations.importLinks : [];
      if (!imports.length && Array.isArray(relations?.imports) && fileSet.size) {
        imports = relations.imports
          .map((spec) => resolveRelativeImport(file, spec, fileSet))
          .filter(Boolean);
      }
      for (const target of imports) {
        if (!target) continue;
        mergeNode(importGraph, target, { file: target }, importGuard, context);
        addDirectedEdge(importGraph, file, target, importGuard, context);
        if (importGuard.disabled) break;
      }
      if (importGuard.disabled) break;
    }
  }

  const payload = {
    version: 2,
    generatedAt: new Date().toISOString(),
    callGraph: serializeGraph(callGraph, { emitNodes }),
    usageGraph: serializeGraph(usageGraph, { emitNodes }),
    importGraph: serializeGraph(importGraph, { emitNodes }),
    caps: {
      callGraph: callGuard.reason ? callGuard : null,
      usageGraph: usageGuard.reason ? usageGuard : null,
      importGraph: importGuard.reason ? importGuard : null
    }
  };
  Object.defineProperty(payload, '__graphs', {
    value: { callGraph, usageGraph, importGraph },
    enumerable: false
  });
  Object.defineProperty(payload, '__streaming', {
    value: !emitNodes,
    enumerable: false
  });
  return payload;
}
