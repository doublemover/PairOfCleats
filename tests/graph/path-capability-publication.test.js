import assert from 'node:assert/strict';
import { buildGraphContextPack } from '../../src/graph/context-pack.js';
import { buildImpactAnalysis } from '../../src/graph/impact.js';
import { validateGraphContextPack, validateGraphImpact, validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { graphRelationsFromEdges } from './helpers/graph-fixtures.js';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';
import { buildContextPackRequestInput } from '../../src/shared/context-pack-request.js';

const graphRelations = graphRelationsFromEdges({ callEdges: [['A', 'B'], ['B', 'C'], ['C', 'A']] });
const base = { graphRelations, seed: { type: 'chunk', chunkUid: 'A' }, indexSignature: 'pinned-graph-v1',
  repo: 'fixture', depth: 3, includePaths: true, pathSemantics: 'graph-witness' };
for (const [direction, impactDirection] of [['out', 'downstream'], ['in', 'upstream'], ['both', 'both']]) {
  const context = buildGraphContextPack({ ...base, direction });
  assert.equal(validateGraphContextPack(context).ok, true);
  assert.equal(context.pathCapability.declaration.operation, 'graph_context');
  assert.equal(context.pathCapability.scope.indexSignature, base.indexSignature);
  assert.equal(context.pathCapability.selection.direction, direction);
  assert.ok(context.pathCapability.declaration.edgeKinds.includes('call'));
  assert.equal(context.pathCapability.completeness.source, 'unqualified');
  assert.equal(context.pathCapability.declaration.feasibility, 'unsupported');
  const impact = buildImpactAnalysis({ ...base, direction: impactDirection });
  assert.equal(validateGraphImpact(impact).ok, true);
  assert.equal(impact.pathCapability.declaration.operation, 'graph_impact');
  assert.equal(impact.pathCapability.declaration.producer.id, 'graph-impact');
  const corrupt = structuredClone(context); corrupt.paths[0].edges[0].to = { type: 'chunk', chunkUid: 'foreign' };
  assert.equal(validateGraphContextPack(corrupt).ok, false);
  const wrongScope = structuredClone(impact); wrongScope.pathCapability.scope.indexSignature = 'other';
  assert.equal(validateGraphImpact(wrongScope).ok, false);
}
const capped = buildGraphContextPack({ ...base, caps: { maxPaths: 1, maxNodes: 2 } });
assert.equal(validateGraphContextPack(capped).ok, true);
assert.equal(capped.pathCapability.completeness.response, 'partial');
assert.ok(capped.pathCapability.completeness.frontier.includes('maxNodes'));
assert.equal(capped.pathCapability.limits.maxPaths, 1);
assert.equal(buildGraphContextPack({ ...base, pathSemantics: undefined }).pathCapability, undefined);
assert.throws(() => buildGraphContextPack({ ...base, pathSemantics: 'feasible-path' }), { code: 'ERR_GRAPH_PATH_CONTRACT' });
assert.throws(() => buildGraphContextPack({ ...base, indexSignature: null, indexCompatKey: 'compat-only' }), { code: 'ERR_GRAPH_PATH_CONTRACT' });
assert.throws(() => buildGraphContextPack({ ...base, graphIndex: { indexSignature: 'other' } }), { code: 'ERR_GRAPH_PATH_CONTRACT' });
assert.throws(() => buildGraphContextPack({ ...base, graphIndex: {
  indexSignature: base.indexSignature, graphRelations: structuredClone(graphRelations)
} }), { code: 'ERR_GRAPH_PATH_CONTRACT' });
const aborted = new AbortController(); aborted.abort();
assert.throws(() => buildImpactAnalysis({ ...base, signal: aborted.signal }), { code: 'ABORT_ERR' });
const unresolved = buildGraphContextPack({ ...base, graphRelations: null, symbolEdges: [{ from: { chunkUid: 'A' },
  to: { v: 1, status: 'unresolved', candidates: [], resolved: null }, type: 'symbol' }] });
assert.equal(validateGraphContextPack(unresolved).ok, true);
assert.ok(unresolved.pathCapability.completeness.frontier.includes('unresolved-edge-target'));
const input = buildContextPackRequestInput({ ...base, includeGraph: true });
const composite = assembleCompositeContextPack({ ...input, indexSignature: base.indexSignature,
  repo: base.repo, graphRelations, includePaths: true });
assert.equal(composite.graph.pathCapability.declaration.operation, 'graph_context');
assert.equal(validateCompositeContextPack(composite).ok, true);
console.log('Actual graph context, impact and composite consumers publish scoped witness capabilities.');
