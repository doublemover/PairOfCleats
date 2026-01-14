import Graph from 'graphology';

const buildChunkKey = (chunk) => `${chunk.file}::${chunk.name}`;

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
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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

  for (const chunk of chunks) {
    if (!chunk?.file || !chunk?.name) continue;
    const key = buildChunkKey(chunk);
    const attrs = {
      file: chunk.file,
      name: chunk.name,
      kind: chunk.kind || null,
      chunkId: chunk.metaV2?.chunkId || null
    };
    mergeNode(callGraph, key, attrs);
    mergeNode(usageGraph, key, attrs);
  }

  for (const chunk of chunks) {
    if (!chunk?.file || !chunk?.name) continue;
    const sourceKey = buildChunkKey(chunk);
    const relations = chunk.codeRelations || {};
    if (Array.isArray(relations.callLinks)) {
      for (const link of relations.callLinks) {
        const targetKey = link?.file && link?.target
          ? `${link.file}::${link.target}`
          : null;
        if (!targetKey) continue;
        mergeNode(callGraph, targetKey, {
          file: link.file || null,
          name: link.target || null,
          kind: link.kind || null
        });
        addDirectedEdge(callGraph, sourceKey, targetKey);
      }
    }
    if (Array.isArray(relations.usageLinks)) {
      for (const link of relations.usageLinks) {
        const targetKey = link?.file && link?.target
          ? `${link.file}::${link.target}`
          : null;
        if (!targetKey) continue;
        mergeNode(usageGraph, targetKey, {
          file: link.file || null,
          name: link.target || null,
          kind: link.kind || null
        });
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
