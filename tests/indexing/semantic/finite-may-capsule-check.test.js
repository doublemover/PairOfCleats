import assert from 'node:assert/strict';
import { checkFiniteMayCapsule, finiteMayPayloadIdentity, finiteMaySystemIdentity }
  from '../../../src/index/semantic/capsules/finite-may-check.js';
import { readCheckedMaySummary } from '../../../src/semantic/checked-may-summary.js';

const system = { profile: 'finite-may-set-v1', transferVersion: 1,
  world: { generation: { baseBuildId: 'build', semanticRevision: 0 }, sourceSnapshotId: 'sources',
    contextKey: 'build-config', repositoryNamespace: 'repo', providerId: 'provider-v1' },
  universe: ['input', 'return', 'throw'], nodes: ['entry', 'loop', 'exit'],
  entries: [{ node: 'entry', facts: ['input'] }],
  edges: [
    { id: 'enter', from: 'entry', to: 'loop', operation: 'identity' },
    { id: 'backedge', from: 'loop', to: 'loop', operation: 'gen-kill', gen: ['return'], kill: [] },
    { id: 'exit', from: 'loop', to: 'exit', operation: 'identity' }
  ], extractionClosure: 'complete-in-model', boundaryClosure: 'complete-in-model', pending: [] };
const capsuleFor = (model, states) => ({ schemaVersion: 1, profile: model.profile,
  checker: 'finite-may-postfixpoint-v1', systemId: finiteMaySystemIdentity(model),
  payloadId: finiteMayPayloadIdentity(states), states });
const states = [{ node: 'entry', facts: ['input'] }, { node: 'loop', facts: ['input', 'return'] },
  { node: 'exit', facts: ['input', 'return'] }];
const capsule = capsuleFor(system, states);
assert.equal(checkFiniteMayCapsule({ system, capsule }).status, 'checked-in-model');
assert.equal(checkFiniteMayCapsule({ system, capsule }).precision, 'sound-overapproximation-not-least');
const top = capsuleFor(system, system.nodes.map(node => ({ node, facts: [...system.universe] })));
assert.equal(checkFiniteMayCapsule({ system, capsule: top }).status, 'checked-in-model', 'sound but imprecise top is legal');
const absentBackedgeFact = capsuleFor(system, system.nodes.map(node => ({ node, facts: ['input'] })));
assert.equal(checkFiniteMayCapsule({ system, capsule: absentBackedgeFact }).status, 'rejected');
assert.ok(checkFiniteMayCapsule({ system, capsule: absentBackedgeFact }).failures.some(row => row.edgeId === 'backedge'));
const empty = capsuleFor(system, system.nodes.map(node => ({ node, facts: [] })));
assert.ok(checkFiniteMayCapsule({ system, capsule: empty }).failures.some(row => row.reason === 'entry-not-covered'));
assert.equal(checkFiniteMayCapsule({ system, capsule: { ...capsule, payloadId: 'forged' } }).structuralIntegrity, 'failed');
assert.equal(checkFiniteMayCapsule({ system: { ...system, world: { ...system.world, contextKey: 'changed' } }, capsule }).status, 'stale-identity');
const external = structuredClone(system); external.edges[2].operation = 'unknown-effect';
assert.equal(checkFiniteMayCapsule({ system: external, capsule: capsuleFor(external, states) }).status, 'rejected');
const open = { ...system, pending: ['unresolved-callback'] };
assert.equal(checkFiniteMayCapsule({ system: open, capsule: capsuleFor(open, states) }).status, 'unknown');
assert.equal(readCheckedMaySummary({ system, capsule, node: 'exit', maxObligations: 1 }).facts, null);
assert.deepEqual(readCheckedMaySummary({ system, capsule, node: 'exit' }).facts, ['input', 'return']);
const controller = new AbortController(); controller.abort();
assert.equal(checkFiniteMayCapsule({ system, capsule, signal: controller.signal }).status, 'unknown');

// Independent exhaustive concrete path oracle for the tiny finite graph: enumerate
// state/node pairs to closure, then demand inclusion in every accepted invariant.
const reached = new Map(system.nodes.map(node => [node, new Set()]));
const pending = [{ node: 'entry', facts: ['input'] }], seen = new Set();
while (pending.length) {
  const current = pending.pop();
  const stateKey = JSON.stringify([current.node, [...current.facts].sort()]);
  if (seen.has(stateKey)) continue;
  seen.add(stateKey);
  for (const value of current.facts) reached.get(current.node).add(value);
  for (const edge of system.edges.filter(row => row.from === current.node)) {
    const next = new Set(current.facts);
    if (edge.operation === 'gen-kill') {
      for (const value of edge.kill) next.delete(value);
      for (const value of edge.gen) next.add(value);
    }
    pending.push({ node: edge.to, facts: [...next] });
  }
}
for (let mask = 0; mask < 512; mask++) {
  const proposed = system.nodes.map((node, n) => ({ node,
    facts: system.universe.filter((_, f) => mask & (1 << (n * 3 + f))) }));
  const checked = checkFiniteMayCapsule({ system, capsule: capsuleFor(system, proposed) });
  if (checked.status === 'checked-in-model') for (const row of proposed) {
    for (const value of reached.get(row.node)) assert.ok(row.facts.includes(value), 'accepted invariant must include independent path semantics');
  }
}
console.log('finite may-summary independent checking contract passed');
