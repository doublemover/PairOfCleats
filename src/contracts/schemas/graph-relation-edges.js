export const GRAPH_RELATION_EDGES_VERSION = 1;

// Retained resolved adjacency is independent of display node/edge/byte limits.
// Source occurrences, ambiguity and upstream omission coverage have their own
// canonical owners; a complete edge enumeration does not prove analysis closure.
export const GRAPH_RELATION_EDGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'graph', 'from', 'to'],
  properties: {
    schemaVersion: { const: GRAPH_RELATION_EDGES_VERSION },
    graph: { enum: ['callGraph', 'usageGraph', 'importGraph'] },
    from: { type: 'string', minLength: 1 },
    to: { type: 'string', minLength: 1 }
  }
};

export const GRAPH_RELATION_EDGES_SCHEMA = { type: 'array', items: GRAPH_RELATION_EDGE_SCHEMA };
