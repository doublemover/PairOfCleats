export const validateGraphCounts = (graphRelations, warnings) => {
  if (!graphRelations || typeof graphRelations !== 'object') return;
  for (const graphName of ['callGraph', 'usageGraph', 'importGraph']) {
    const graph = graphRelations[graphName];
    if (!graph || typeof graph !== 'object') continue;
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const invalidNodes = [];
    if (Number.isFinite(graph.nodeCount) && graph.nodeCount !== nodes.length) {
      warnings.push({
        code: 'GRAPH_COUNT_MISMATCH',
        message: `${graphName} nodeCount does not match node list length.`,
        data: { graph: graphName, expected: graph.nodeCount, actual: nodes.length }
      });
    }
    if (Number.isFinite(graph.edgeCount)) {
      let actualEdges = 0;
      for (const node of nodes) {
        if (!node || typeof node.id !== 'string' || !Array.isArray(node.out) || !Array.isArray(node.in)) {
          if (invalidNodes.length < 3) {
            invalidNodes.push({ id: node?.id ?? null });
          }
        }
        const out = Array.isArray(node?.out) ? node.out.length : 0;
        actualEdges += out;
      }
      if (graph.edgeCount !== actualEdges) {
        warnings.push({
          code: 'GRAPH_COUNT_MISMATCH',
          message: `${graphName} edgeCount does not match out-edge totals.`,
          data: { graph: graphName, expected: graph.edgeCount, actual: actualEdges }
        });
      }
    }
    if (invalidNodes.length) {
      warnings.push({
        code: 'GRAPH_NODE_INVALID',
        message: `${graphName} nodes missing required id/out/in fields.`,
        data: { graph: graphName, samples: invalidNodes }
      });
    }
  }
};
