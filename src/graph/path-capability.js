import { canonicalSemanticJson } from '../index/semantic/identity.js';
import { GRAPH_PATH_EDGE_KINDS } from '../contracts/schemas/semantic-path.js';
import { graphWitnessPathDeclaration } from '../semantic/path-capabilities.js';
import { normalizeCaps, normalizeDirection } from './neighborhood/caps.js';
import { GRAPH_NAMES, normalizeEdgeFilter } from './neighborhood/filter.js';
import { nodeKey } from './ordering.js';
import { resolveSeedNodeRef } from './neighborhood/seed-meta.js';
import { throwIfAborted } from '../shared/abort.js';
import { resolveImpactDirection } from './impact-direction.js';
import { GRAPH_PATH_CAPABILITY_SCHEMA } from '../contracts/schemas/analysis/graph.js';
import { compileSchema, createAjv } from '../shared/validation/ajv-factory.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_GRAPH_PATH_CONTRACT' });
const validateCapability = compileSchema(createAjv({ strict: true, allErrors: true, allowUnionTypes: true }), GRAPH_PATH_CAPABILITY_SCHEMA);
const same = (a, b) => canonicalSemanticJson(a) === canonicalSemanticJson(b);
const refKind = ref => nodeKey(ref) && (ref.chunkUid || ref.symbolId || ref.path) ? ref.type : null;

/** Validate only the bounded returned substrate; source extraction stays unqualified. */
export const graphPathProjectionErrors = (payload, operation) => {
  const cap = payload.pathCapability;
  if (!cap) return [];
  if (!validateCapability(cap)) return ['Invalid canonical graph path capability.'];
  const errors = [];
  if (!same(cap.declaration, graphWitnessPathDeclaration(operation))
    || cap.scope.indexSignature !== payload.provenance?.indexSignature
    || cap.scope.repo !== (payload.provenance?.repo || null)
    || !same(cap.limits, normalizeCaps(payload.provenance?.capsUsed?.graph))) errors.push('Graph path declaration, pinned scope or provenance allowance mismatch.');
  const edges = operation === 'graph_context' ? payload.edges : [];
  for (const edge of edges || []) {
    const from = resolveSeedNodeRef(edge.from), to = resolveSeedNodeRef(edge.to);
    const domain = edge.graph === 'importGraph' ? 'file' : ['callGraph', 'usageGraph'].includes(edge.graph) ? 'chunk' : null;
    if (!GRAPH_PATH_EDGE_KINDS.includes(edge.edgeType) || !cap.selection.edgeKinds.includes(edge.edgeType)
      || !cap.selection.graphs.includes(edge.graph) || !refKind(from) || to && !refKind(to)
      || domain && (from.type !== domain || to?.type !== domain)) errors.push('Graph edge differs from its declared relation domain or selection.');
  }
  const paths = operation === 'graph_context' ? payload.paths || [] : (payload.impacted || []).map(row => row.witnessPath).filter(Boolean);
  if (operation === 'graph_context' && !cap.selection.paths && paths.length
    || operation === 'graph_impact' && cap.selection.direction !== resolveImpactDirection(payload.direction, { graphs: cap.selection.graphs }).traversal
    || cap.limits.maxPaths != null && paths.length > cap.limits.maxPaths) errors.push('Graph witness selection or path allowance mismatch.');
  for (const path of paths) {
    if (!Array.isArray(path.nodes) || !path.nodes.length || !Array.isArray(path.edges)
      || path.edges.length !== path.nodes.length - 1 || path.distance !== path.edges.length
      || path.distance > cap.selection.depth || !same(path.to, path.nodes.at(-1))) { errors.push('Graph witness chain shape differs from its endpoint or distance.'); continue; }
    for (let i = 0; i < path.edges.length; i++) {
      const edge = path.edges[i], a = nodeKey(path.nodes[i]), b = nodeKey(path.nodes[i + 1]);
      const out = nodeKey(edge.from) === a && nodeKey(edge.to) === b;
      const into = nodeKey(edge.to) === a && nodeKey(edge.from) === b;
      if (!a || !b || !cap.selection.edgeKinds.includes(edge.edgeType)
        || !(cap.selection.direction === 'out' ? out : cap.selection.direction === 'in' ? into : out || into)) {
        errors.push('Graph witness edge does not connect adjacent nodes in its selected direction.');
      }
    }
  }
  if ((payload.truncation?.length || payload.warnings?.length) && cap.completeness.response !== 'partial') errors.push('Graph path completeness suppresses reported frontiers.');
  return errors;
};

export const attachGraphPathCapability = (payload, { pathSemantics, operation, graphIndex, graphRelations, edgeFilters, caps,
  direction, depth, includePaths, signal } = {}) => {
  throwIfAborted(signal);
  if (pathSemantics === undefined) return payload;
  if (pathSemantics !== 'graph-witness') throw fail('Unsupported graph path semantics.');
  const signature = payload.provenance?.indexSignature;
  if (!signature || graphIndex?.indexSignature && graphIndex.indexSignature !== signature) throw fail('Graph path declaration requires the exact selected index signature.');
  if (graphIndex?.graphRelations && graphRelations && graphIndex.graphRelations !== graphRelations) {
    throw fail('Graph witness cannot rebind a pinned index signature to different relation inputs.');
  }
  const filter = normalizeEdgeFilter(edgeFilters);
  const frontier = [...new Set([...(payload.truncation || []).map(row => row.cap), ...(payload.warnings || []).map(row => row.code),
    ...((payload.edges || []).some(edge => !resolveSeedNodeRef(edge.to)) ? ['unresolved-edge-target'] : []),
    ...(!includePaths ? ['witnesses-not-requested'] : [])])];
  payload.pathCapability = {
    declaration: graphWitnessPathDeclaration(operation), scope: { repo: payload.provenance.repo || null, indexSignature: signature },
    selection: { direction: normalizeDirection(direction), depth, graphs: [...(filter.graphs || GRAPH_NAMES)].filter(name => GRAPH_NAMES.has(name)),
      edgeKinds: [...(filter.edgeTypes || GRAPH_PATH_EDGE_KINDS)], paths: includePaths === true },
    limits: normalizeCaps(caps), completeness: { source: 'unqualified', response: frontier.length ? 'partial' : 'bounded-selection', frontier },
    validation: 'returned-edge-domains-and-witness-chain', execution: 'none'
  };
  const errors = graphPathProjectionErrors(payload, operation);
  if (errors.length) throw fail(errors.join(' '));
  return payload;
};
