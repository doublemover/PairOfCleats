import assert from 'node:assert/strict';
import { createRepositoryAnswerInput } from '../../helpers/repository-answer-input.js';
import { buildEvidenceWindow, deliveryDigest, deliveryBytes, deliveryJson, inspectEvidenceWindow } from '../../../src/context-pack/delivery/manifest.js';
import { planEvidenceDelivery } from '../../../src/context-pack/delivery/plan.js';
import { applyEvidenceDelivery } from '../../../src/context-pack/delivery/apply.js';
import { createEvidenceWindowWitnessOwner } from '../../../src/context-pack/delivery/window-witness.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('context-pack/delivery/protocol/')[1];
assert.ok(['full-source-manifest', 'delta-reconstruction-oracle', 'reset-and-consumer-isolation', 'loss-order-and-eviction', 'integrity-and-coordinates', 'full-cost-and-cancellation'].includes(mode));
const world = createRepositoryAnswerInput().queryReceipt.world;
const context = { consumerId: 'implementer', sessionId: 'session-1', contextEpoch: 0, windowRevision: 0,
  taskRef: { id: 'migration', revision: '1' }, branchId: 'branch-1', scopeDigest: 'a'.repeat(64), policyDigest: 'b'.repeat(64), worldRef: world };
const request = (overrides = {}) => ({ schemaVersion: 1, contextRef: context, expectedBaseDigest: null,
  requiredExactSourceRoles: ['caller-source'], unresolvedRoles: ['configuration-binding'],
  continuation: { producerId: 'retained-query', requestDigest: 'c'.repeat(64), cursor: 'opaque-token-unaltered' },
  limits: { packetBytes: 131072, reconstructedBytes: 131072 }, ...overrides });
const entry = (index, text = 'call(' + index + ');') => ({ observationIds: [String(index + 1).padStart(64, '0')], representation: 'exact-source',
  source: { sourceUnitId: 'su1:' + 'd'.repeat(64), sourceHash: 'e'.repeat(64), path: 'src/call.js', span: [index * 100, index * 100 + text.length], coordinateUnit: 'utf16' },
  roles: ['caller-source'], qualifiers: ['retained source, no runtime behavior claim'], dependencyIds: ['f'.repeat(64)], text });
const owner = () => createEvidenceWindowWitnessOwner({ consumerId: context.consumerId, sessionId: context.sessionId });
const next = (base, overrides = {}) => request({ contextRef: { ...context, windowRevision: base.manifest.contextRef.windowRevision + 1 }, expectedBaseDigest: base.manifest.digest, ...overrides });
const resign = input => {
  const plan = structuredClone(input); plan.packetId = '0'.repeat(64);
  for (let index = 0; index < 8; index++) { const bytes = deliveryBytes(plan); if (bytes === plan.cost.transmittedBytes) break; plan.cost.transmittedBytes = bytes; }
  const { packetId: _id, ...unsigned } = plan; plan.packetId = deliveryDigest('packet', unsigned); return plan;
};
if (mode === 'full-source-manifest') {
  const exact = entry(0, 'A😀B'), summary = { ...entry(1), representation: 'synopsis', source: null, roles: ['configuration-binding'], text: 'Configuration is mentioned; its source is not delivered.' };
  const input = request({ requiredExactSourceRoles: ['caller-source', 'configuration-binding'] });
  const plan = planEvidenceDelivery(input, [exact, summary]), window = applyEvidenceDelivery(null, plan);
  assert.equal(plan.mode, 'full'); assert.equal(plan.fallbackReason, null);
  assert.equal(plan.operations.invalidateCurrentUse, 'all-previous-window');
  assert.deepEqual(window.bodies.map(body => body.text), [exact.text, summary.text]);
  assert.deepEqual(window.manifest.unresolvedRoles, ['configuration-binding']);
  assert.deepEqual(window.manifest.continuation, input.continuation);
  assert.equal(window.manifest.cost.renderedPackBytes, Buffer.byteLength(deliveryJson(window)) + 1);
  assert.equal(window.manifest.cost.fullPromptTokens, null); assert.equal(window.manifest.cost.fullPromptBytes, null);
  const contradiction = { ...entry(0), observationIds: ['9'.repeat(64)], qualifiers: ['supplied contradictory observation; not adjudicated'], text: 'call(9);' };
  const conflicted = applyEvidenceDelivery(null, planEvidenceDelivery(request(), [entry(0), contradiction]));
  assert.equal(conflicted.bodies.length, 2, 'same source origin/path never merges distinct observation identities or counter-evidence');
} else if (mode === 'delta-reconstruction-oracle') {
  const pool = [entry(0), entry(1, 'quote("\\");'), entry(2, '😀 source'), entry(3, '')];
  // Independent full-selection oracle: every subset and order-preserving next
  // subset reconstructs exactly, including empty targets and overlap patterns.
  for (let before = 0; before < 16; before++) for (let after = 0; after < 16; after++) {
    const retained = pool.filter((_, index) => before & (1 << index)), desired = pool.filter((_, index) => after & (1 << index));
    const base = buildEvidenceWindow(request(), retained), host = owner(), witness = host.issue(base);
    const targetRequest = next(base), plan = planEvidenceDelivery(targetRequest, desired, witness), actual = applyEvidenceDelivery(base, plan);
    const full = buildEvidenceWindow(targetRequest, desired);
    assert.equal(plan.mode, 'delta'); assert.deepEqual(actual, full);
    assert.deepEqual(actual.bodies.map(body => body.text), desired.map(value => value.text));
    assert.equal(plan.operations.retain.length, pool.filter((_, index) => before & after & (1 << index)).length);
    assert.equal(plan.bodies.length, pool.filter((_, index) => after & ~(before) & (1 << index)).length);
    assert.deepEqual(applyEvidenceDelivery(actual, plan), actual, 'an exact already-applied target is idempotent');
  }
} else if (mode === 'reset-and-consumer-isolation') {
  const base = buildEvidenceWindow(request(), [entry(0)]), host = owner(), witness = host.issue(base);
  const forged = planEvidenceDelivery(next(base), [entry(0)], JSON.parse(JSON.stringify(witness)));
  assert.equal(forged.mode, 'full'); assert.equal(forged.fallbackReason, 'UnsupportedAdapter'); assert.equal(forged.bodies.length, 1);
  for (const [field, value, reason] of [['consumerId', 'reviewer', 'ScopeDenied'], ['sessionId', 'other', 'ScopeDenied'],
    ['scopeDigest', '1'.repeat(64), 'ScopeDenied'], ['policyDigest', '2'.repeat(64), 'ScopeDenied'], ['contextEpoch', 1, 'EpochMismatch'],
    ['worldRef', { ...world, sourceSnapshotId: 'changed-world' }, 'SourceStale']]) {
    const plan = planEvidenceDelivery(next(base, { contextRef: { ...context, windowRevision: 1, [field]: value } }), [entry(0)], witness);
    assert.equal(plan.mode, 'full'); assert.equal(plan.fallbackReason, reason); assert.equal(plan.bodies.length, 1);
    assert.deepEqual(plan.operations.retain, []); assert.equal(plan.baseDigest, null);
  }
  host.reset(); assert.equal(planEvidenceDelivery(next(base), [entry(0)], witness).mode, 'full');
  const other = createEvidenceWindowWitnessOwner({ consumerId: 'reviewer', sessionId: context.sessionId });
  assert.throws(() => other.issue(base), { reason: 'ScopeDenied' });
} else if (mode === 'loss-order-and-eviction') {
  let base = buildEvidenceWindow(request(), [entry(0), entry(1)]), host = owner(), witness = host.issue(base);
  const lost = planEvidenceDelivery(next(base), [entry(0), entry(2)], witness);
  assert.deepEqual(planEvidenceDelivery(next(base), [entry(0), entry(2)], witness), lost, 'lost packets do not advance the acknowledged base and retry retains exact identity');
  const target = applyEvidenceDelivery(base, lost); witness = host.issue(target);
  assert.equal(planEvidenceDelivery(next(base), [entry(0)], witness).mode, 'full', 'a stale base cannot reuse an advanced witness');
  const evicted = planEvidenceDelivery(next(target), [entry(2)], witness);
  assert.equal(evicted.operations.removeFromWindow.length, 1); assert.deepEqual(evicted.operations.invalidateCurrentUse, evicted.operations.removeFromWindow);
  base = applyEvidenceDelivery(target, evicted); witness = host.issue(base);
  const restored = planEvidenceDelivery(next(base), [entry(0), entry(2)], witness);
  assert.equal(restored.bodies.length, 1, 'an evicted source is sent again instead of being suppressed as previously observed');
  assert.throws(() => applyEvidenceDelivery(target, restored), { reason: 'UnknownBase' });
  assert.deepEqual(applyEvidenceDelivery(base, restored).bodies.map(body => body.text), [entry(0).text, entry(2).text]);
} else if (mode === 'integrity-and-coordinates') {
  const base = buildEvidenceWindow(request(), [entry(0)]), plan = planEvidenceDelivery(next(base), [entry(1)]);
  for (const mutate of [p => { p.bodies[0].text += 'extra'; }, p => { p.bodies = []; }, p => { p.operations.add = []; },
    p => { p.target.entries[0].roles = []; }, p => { p.cost.reconstructedPackBytes--; }]) {
    const changed = structuredClone(plan); mutate(changed);
    assert.throws(() => applyEvidenceDelivery(base, resign(changed)));
  }
  const target = applyEvidenceDelivery(base, plan), corruptReplay = structuredClone(plan); corruptReplay.bodies[0].text += 'x';
  assert.throws(() => applyEvidenceDelivery(target, resign(corruptReplay)), { reason: 'TargetDigestMismatch' }, 'already-applied targets do not excuse corrupted packet bodies');
  assert.throws(() => planEvidenceDelivery(request(), [{ ...entry(0), text: '\ud800' }]), { reason: 'RepresentationMismatch' });
  assert.throws(() => planEvidenceDelivery(request(), [{ ...entry(0), source: { ...entry(0).source, coordinateUnit: 'byte' } }]));
  assert.throws(() => planEvidenceDelivery(request(), [{ ...entry(0), representation: 'synopsis' }]), { reason: 'RepresentationMismatch' });
  assert.throws(() => planEvidenceDelivery(request(), [entry(0), entry(0)]), { reason: 'RepresentationMismatch' });
  const broken = structuredClone(target); broken.manifest.entries[0].source.span[1]--;
  assert.throws(() => inspectEvidenceWindow(broken));
} else {
  const large = entry(0, 'x'.repeat(60000)), base = buildEvidenceWindow(request(), [large]), host = owner(), witness = host.issue(base);
  const delta = planEvidenceDelivery(next(base), [large], witness);
  assert.ok(delta.cost.transmittedBytes < 10000); assert.ok(delta.cost.reconstructedPackBytes > 60000);
  assert.throws(() => planEvidenceDelivery(next(base, { limits: { packetBytes: 20000, reconstructedBytes: 20000 } }), [large], witness), { reason: 'MandatoryOverflow' });
  const smallWire = next(base, { limits: { packetBytes: 1024, reconstructedBytes: 131072 } });
  assert.throws(() => planEvidenceDelivery(smallWire, [large], witness), { reason: 'MandatoryOverflow' });
  const controller = new AbortController(); controller.abort();
  assert.throws(() => planEvidenceDelivery(request(), [], null, { signal: controller.signal }), { name: 'AbortError' });
  assert.throws(() => applyEvidenceDelivery(base, delta, { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(inspectEvidenceWindow(base), base);
}
console.log('Evidence delivery preserves complete source reconstruction, consumer bases and full rendered cost.');
