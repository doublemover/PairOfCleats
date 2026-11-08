import assert from 'node:assert/strict';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { checkFiniteMayCapsule, finiteMayPayloadIdentity, finiteMaySystemIdentity }
  from '../../../src/index/semantic/capsules/finite-may-check.js';
import { readCheckedMaySummary } from '../../../src/semantic/checked-may-summary.js';

const system = { profile: 'finite-may-set-v1', transferVersion: 1,
  world: { generation: { baseBuildId: 'bounded-build', semanticRevision: 0 }, sourceSnapshotId: 'sources',
    contextKey: 'config', repositoryNamespace: 'repo', providerId: 'fixture' },
  universe: ['input'], nodes: ['entry', 'exit'], entries: [{ node: 'entry', facts: ['input'] }],
  edges: [{ id: 'flow', from: 'entry', to: 'exit', operation: 'identity' }],
  extractionClosure: 'complete-in-model', boundaryClosure: 'complete-in-model', pending: [] };
const states = system.nodes.map(node => ({ node, facts: ['input'] }));
const capsule = { schemaVersion: 1, profile: system.profile, checker: 'finite-may-postfixpoint-v1',
  systemId: finiteMaySystemIdentity(system), payloadId: finiteMayPayloadIdentity(states), states };
const exactBytes = Buffer.byteLength(canonicalSemanticJson({ system, capsule }));
const accepted = checkFiniteMayCapsule({ system, capsule, maxBytes: exactBytes });
assert.equal(accepted.status, 'checked-in-model');
assert.deepEqual(readCheckedMaySummary({ system, capsule, node: 'exit', maxBytes: exactBytes }).facts, ['input']);
for (const read of [
  options => checkFiniteMayCapsule(options),
  options => readCheckedMaySummary({ ...options, node: 'exit' }).check
]) {
  const exhausted = read({ system, capsule, maxBytes: exactBytes - 1 });
  assert.equal(exhausted.status, 'unknown');
  assert.equal(exhausted.structuralIntegrity, 'unchecked');
  assert.equal(exhausted.checkedObligations, 0);
  assert.deepEqual(exhausted.frontier, [{ reason: 'encoded-byte-allowance' }]);
}
let enumerations = 0;
const huge = new Proxy(new Array(1000000), { ownKeys() {
  enumerations++;
  throw new Error('Oversized certificate inventory must not be enumerated.');
} });
const oversized = { ...capsule, extra: huge };
assert.equal(checkFiniteMayCapsule({ system, capsule: oversized, maxBytes: 4096 }).status, 'unknown');
const unavailable = readCheckedMaySummary({ system, capsule: oversized, node: 'exit', maxBytes: 4096 });
assert.equal(unavailable.facts, null);
assert.equal(unavailable.negativeMeaning, 'unknown');
assert.equal(enumerations, 0, 'array cardinality denies capture before caller property enumeration');

let getterReads = 0;
const active = { ...capsule, get extra() { getterReads++; return 'caller code'; } };
assert.throws(() => checkFiniteMayCapsule({ system, capsule: active }), /getters/);
assert.throws(() => readCheckedMaySummary({ system, capsule: active, node: 'exit' }), /getters/);
assert.equal(getterReads, 0);
const foreign = new Proxy({}, { ownKeys() { throw new Error('Foreign domain certificate inspected.'); } });
assert.deepEqual(checkFiniteMayCapsule({ system: { profile: 'other-domain', transferVersion: 1 }, capsule: foreign }).frontier,
  [{ reason: 'unsupported-domain-or-transfer' }]);
assert.throws(() => checkFiniteMayCapsule({ system }), { code: 'ERR_ANALYSIS_CAPSULE_CONTRACT' });
assert.throws(() => checkFiniteMayCapsule({ system, capsule, maxBytes: 0 }), { code: 'ERR_ANALYSIS_CAPSULE_CONTRACT' });

// The second signal read occurs after digest/identity checks. A caller cannot
// rewrite the accepted identity or states after the kernel has checked them.
const mutableSystem = structuredClone(system), mutableCapsule = structuredClone(capsule);
let signalReads = 0;
const signal = { get aborted() {
  if (++signalReads === 2) {
    mutableCapsule.systemId = 'forged-after-check';
    mutableCapsule.payloadId = 'forged-after-check';
    mutableCapsule.states.find(state => state.node === 'exit').facts = [];
    mutableSystem.entries[0].facts = [];
  }
  return false;
} };
const pinned = checkFiniteMayCapsule({ system: mutableSystem, capsule: mutableCapsule, signal });
assert.ok(signalReads >= 2);
assert.equal(mutableCapsule.systemId, 'forged-after-check');
assert.equal(pinned.status, 'checked-in-model');
assert.equal(pinned.systemId, accepted.systemId);
assert.equal(pinned.payloadId, accepted.payloadId);
assert.equal(pinned.checkId, accepted.checkId);
console.log('finite may checker and summary bounded private-input ownership controls passed');
