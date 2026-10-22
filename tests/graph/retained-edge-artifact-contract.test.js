import assert from 'node:assert/strict';
import { validateArtifact } from '../../src/contracts/validators/artifacts.js';
import { GRAPH_RELATION_EDGES_VERSION } from '../../src/contracts/schemas/graph-relation-edges.js';
import { resolveJsonlRequiredKeys } from '../../src/shared/artifact-io/jsonl.js';

const row = { schemaVersion: GRAPH_RELATION_EDGES_VERSION,
  graph: 'callGraph', from: 'caller:1', to: 'callee:2' };
assert.equal(validateArtifact('graph_relation_edges', [row]).ok, true);
for (const changed of [
  { ...row, schemaVersion: 0 }, { ...row, graph: 'unknown' },
  { ...row, from: '' }, { ...row, to: null }, { ...row, extra: true }
]) {
  assert.equal(validateArtifact('graph_relation_edges', [changed]).ok, false);
}
const missing = { ...row }; delete missing.schemaVersion;
assert.equal(validateArtifact('graph_relation_edges', [missing]).ok, false);
assert.deepEqual(resolveJsonlRequiredKeys('graph_relation_edges'), ['schemaVersion', 'graph', 'from', 'to']);
assert.equal(validateArtifact('graph_relation_edges', []).ok, true,
  'an empty retained set is valid data but carries no independent closure proof');
console.log('Retained graph edge artifact has an independent strict versioned row contract');
