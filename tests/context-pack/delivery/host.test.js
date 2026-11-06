import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRepositoryAnswerInput } from '../../helpers/repository-answer-input.js';
import { createRepositoryQuestionFixture } from '../../helpers/repository-question-fixture.js';
import { createEvidenceDeliveryHost } from '../../../src/context-pack/delivery/host.js';
import { createMemoryEvidenceWindowAdapter } from '../../../src/context-pack/delivery/memory-window.js';
import { createRepositoryAnswerDeliveryProvider } from '../../../src/context-pack/delivery/answer-provider.js';
import { deliveryJson, buildEvidenceWindow } from '../../../src/context-pack/delivery/manifest.js';
import { runRepositoryQuery } from '../../../src/integrations/tooling/repository-query.js';
import { runRepositoryAnswer } from '../../../src/integrations/tooling/repository-answer.js';
import { createRepositoryAnswerEvidenceVerifier } from '../../../src/integrations/tooling/repository-answer-evidence.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('context-pack/delivery/host/')[1];
assert.ok(['bound-consumer-and-reset', 'ack-and-loss', 'source-and-permission-recheck', 'cancel-and-original-failure', 'atomic-host-and-readback', 'live-answer-provider', 'original-verifier-close'].includes(mode));
const world = createRepositoryAnswerInput().queryReceipt.world;
const source = { sourceUnitId: 'su1:' + 'a'.repeat(64), sourceHash: 'b'.repeat(64), path: 'src/call.js', span: [0, 4], coordinateUnit: 'utf16' };
const evidence = index => ({ observationIds: [String(index + 1).padStart(64, '0')], representation: 'exact-source', source,
  roles: ['caller-source'], qualifiers: ['supplied provider fixture, not live source authority'], dependencyIds: ['c'.repeat(64)], text: index ? 'g();' : 'f();' });
const create = (overrides = {}) => {
  const context = { consumerId: 'implementer', sessionId: 'session', contextEpoch: 0, windowRevision: 0,
    taskRef: { id: 'question', revision: '1' }, branchId: 'branch', scopeDigest: 'd'.repeat(64), policyDigest: 'e'.repeat(64), worldRef: world };
  const channels = new Map([[Symbol('implementer'), { ...context }], [Symbol('reviewer'), { ...context, consumerId: 'reviewer' }]]);
  const [a, b] = channels.keys(), memory = createMemoryEvidenceWindowAdapter();
  let allowed = true, selectionAllowed = true, evidenceAllowed = true, beforeProduce = null, calls = 0, published = 0;
  const authority = ({ windowRevision: _revision, ...value }) => value;
  const boundary = { bind: async transport => {
    const current = channels.get(transport); if (!current) throw Object.assign(new Error('unbound channel'), { code: 'ERR_SCOPE_DENIED' });
    const captured = structuredClone(current), actual = await memory.readWindow({ contextRef: current });
    const contextRef = { ...captured, windowRevision: actual?.manifest.contextRef.contextEpoch === current.contextEpoch ? actual.manifest.contextRef.windowRevision : 0 };
    return { contextRef, recheck: async () => allowed && deliveryJson(authority(captured)) === deliveryJson(authority(channels.get(transport))),
      authorizeSelection: async () => allowed && selectionAllowed, authorizeEvidence: async () => allowed && evidenceAllowed };
  } };
  const provider = { captureSelection: input => {
    assert.deepEqual(Object.keys(input), ['choice']); assert.ok([0, 1].includes(input.choice)); return Object.freeze({ choice: input.choice });
  }, admit: async (selection, { contextRef, signal }) => {
    calls++; await beforeProduce?.({ selection, contextRef, signal });
    return { worldRef: contextRef.worldRef, evidence: [evidence(selection.choice)], continuation: null, publish: () => { published++; } };
  } };
  const host = createEvidenceDeliveryHost({ boundary, provider: overrides.provider || provider, adapter: overrides.wrapAdapter?.(memory) || memory });
  const request = async (transport = a, more = {}) => {
    const described = await host.describe(transport);
    return { schemaVersion: 1, contextRef: { ...described.contextRef, windowRevision: described.contextRef.windowRevision + 1 },
      expectedBaseDigest: described.actualWindowDigest, requiredExactSourceRoles: ['caller-source'], unresolvedRoles: ['configuration'], continuation: null,
      limits: { packetBytes: 131072, reconstructedBytes: 131072 }, ...more };
  };
  return { host, memory, boundary, channels, a, b, request, counts: () => ({ calls, published }),
    allow: value => { allowed = value; }, allowSelection: value => { selectionAllowed = value; }, allowEvidence: value => { evidenceAllowed = value; },
    produce: callback => { beforeProduce = callback; } };
};
if (mode === 'bound-consumer-and-reset') {
  const fixture = create(), input = await fixture.request(), forged = structuredClone(input); forged.contextRef.consumerId = 'reviewer';
  await assert.rejects(fixture.host.plan(forged, { choice: 0 }, fixture.a), { reason: 'EpochMismatch' });
  assert.equal(fixture.counts().calls, 0);
  const first = await fixture.host.plan(input, { choice: 0 }, fixture.a); await fixture.host.apply(first.packetId, fixture.a);
  const reviewer = await fixture.host.plan(await fixture.request(fixture.b), { choice: 0 }, fixture.b);
  assert.equal(reviewer.mode, 'full'); assert.equal(reviewer.bodies.length, 1, 'implementer ACK cannot suppress reviewer evidence');
  await assert.rejects(fixture.host.apply(first.packetId, fixture.b), { reason: 'UnknownBase' });
  fixture.channels.get(fixture.a).contextEpoch++;
  const reset = await fixture.host.plan(await fixture.request(), { choice: 0 }, fixture.a);
  assert.equal(reset.mode, 'full'); assert.equal(reset.fallbackReason, 'EpochMismatch'); assert.equal(reset.bodies.length, 1);
  const receipt = await fixture.host.apply(reset.packetId, fixture.a); assert.equal(receipt.contextRef.contextEpoch, 1);
} else if (mode === 'ack-and-loss') {
  const fixture = create(), input = await fixture.request(), first = await fixture.host.plan(input, { choice: 0 }, fixture.a);
  assert.equal((await fixture.host.describe(fixture.a)).actualWindowDigest, null, 'sending a plan does not advance visibility');
  assert.deepEqual(await fixture.host.redeliver(first.packetId, fixture.a), first);
  await assert.rejects(fixture.host.apply('0'.repeat(64), fixture.a), { reason: 'UnknownBase' });
  const receipt = await fixture.host.apply(first.packetId, fixture.a);
  assert.equal(receipt.targetDigest, first.target.digest); assert.equal(receipt.availability, 'host-owned-pack-window');
  assert.equal(receipt.fullPromptTokens, null);
  assert.deepEqual(await fixture.host.apply(first.packetId, fixture.a), receipt, 'lost ACK delivery can reconcile the exact already-committed target');
  const second = await fixture.host.plan(await fixture.request(), { choice: 0 }, fixture.a);
  assert.equal(second.mode, 'delta'); assert.equal(second.bodies.length, 0);
  const newer = await fixture.host.plan(await fixture.request(), { choice: 1 }, fixture.a);
  await assert.rejects(fixture.host.apply(second.packetId, fixture.a), { reason: 'UnknownBase' });
  await fixture.host.apply(newer.packetId, fixture.a);
  assert.ok(fixture.counts().calls >= 6, 'every release revalidates actual selected evidence instead of trusting a stale receipt');
} else if (mode === 'source-and-permission-recheck') {
  const fixture = create(), input = await fixture.request();
  fixture.allowSelection(false);
  await assert.rejects(fixture.host.plan(input, { choice: 0 }, fixture.a), { reason: 'ScopeDenied' }); assert.equal(fixture.counts().calls, 0);
  fixture.allowSelection(true); fixture.produce(() => { fixture.allowEvidence(false); });
  await assert.rejects(fixture.host.plan(input, { choice: 0 }, fixture.a), { reason: 'ScopeDenied' }); assert.equal(fixture.counts().published, 0);
  fixture.allowEvidence(true); fixture.produce(null);
  let decisionReady = false;
  const decision = Object.freeze({ cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, decision); return decisionReady; } });
  fixture.allowEvidence(decision);
  await assert.rejects(fixture.host.plan(input, { choice: 0 }, fixture.a), error => error.cacheOwnershipReleased() === false);
  const decisions = fixture.counts().calls; fixture.allowEvidence(true);
  await assert.rejects(fixture.host.plan(input, { choice: 0 }, fixture.a)); assert.equal(fixture.counts().calls, decisions);
  decisionReady = true;
  const first = await fixture.host.plan(input, { choice: 0 }, fixture.a);
  fixture.allow(false);
  await assert.rejects(fixture.host.redeliver(first.packetId, fixture.a), { reason: 'ScopeDenied' });
  await assert.rejects(fixture.host.apply(first.packetId, fixture.a), { reason: 'ScopeDenied' });
  fixture.allow(true);
  fixture.produce(() => { fixture.channels.get(fixture.a).worldRef = { ...world, sourceSnapshotId: 'changed' }; });
  await assert.rejects(fixture.host.apply(first.packetId, fixture.a), { reason: 'ScopeDenied' });
  assert.equal(await fixture.memory.readWindow({ contextRef: fixture.channels.get(fixture.a) }), null);
  fixture.produce(null);
  await assert.rejects(fixture.host.redeliver(first.packetId, fixture.a), { reason: 'EpochMismatch' });
} else if (mode === 'cancel-and-original-failure') {
  const fixture = create(), controller = new AbortController(), input = await fixture.request();
  fixture.produce(() => { controller.abort(); });
  await assert.rejects(fixture.host.plan(input, { choice: 0 }, fixture.a, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal((await fixture.host.describe(fixture.a)).actualWindowDigest, null); assert.equal(fixture.counts().published, 0);
  let settled = false;
  const original = Object.assign(new Error('original provider work pending'), { cacheOwnershipPending: true, cacheOwnershipReleased() { return settled; } });
  fixture.produce(() => { throw original; });
  await assert.rejects(fixture.host.plan(input, { choice: 0 }, fixture.a), error => error === original);
  const calls = fixture.counts().calls;
  await assert.rejects(fixture.host.plan(input, { choice: 0 }, fixture.a)); assert.equal(fixture.counts().calls, calls, 'pending original work blocks another provider attempt');
  settled = true; fixture.produce(null);
  const plan = await fixture.host.plan(input, { choice: 0 }, fixture.a); await fixture.host.apply(plan.packetId, fixture.a);
} else if (mode === 'atomic-host-and-readback') {
  let pretend = true;
  const fixture = create({ wrapAdapter: memory => ({ ...memory, replaceWindow: async (...args) => pretend ? true : memory.replaceWindow(...args) }) });
  const first = await fixture.host.plan(await fixture.request(), { choice: 0 }, fixture.a);
  await assert.rejects(fixture.host.apply(first.packetId, fixture.a), { reason: 'TargetDigestMismatch' });
  assert.equal((await fixture.host.describe(fixture.a)).actualWindowDigest, null);
  pretend = false; await fixture.host.apply(first.packetId, fixture.a);
  const next = await fixture.host.plan(await fixture.request(), { choice: 1 }, fixture.a), binding = await fixture.boundary.bind(fixture.a);
  const external = buildEvidenceWindow(await fixture.request(), [evidence(0)]);
  await fixture.memory.replaceWindow({ expectedDigest: first.target.digest, window: external }, binding);
  await assert.rejects(fixture.host.apply(next.packetId, fixture.a), { reason: 'UnknownBase' });
  assert.equal((await fixture.host.describe(fixture.a)).actualWindowDigest, external.manifest.digest);
} else if (mode === 'live-answer-provider') {
  const semantic = await createRepositoryQuestionFixture();
  try {
    let queryCalls = 0;
    const provider = createRepositoryAnswerDeliveryProvider({ runner: (...args) => {
        assert.equal(++queryCalls, 1, 'ACK/redelivery must verify the exact delivered projection, not rerun a time-bounded query page');
        return runRepositoryAnswer(...args);
      } }), fixture = create({ provider });
    fixture.channels.get(fixture.a).worldRef = semantic.request.question.world;
    fixture.channels.get(fixture.a).taskRef = { id: 'live-source-question', revision: '1' };
    const selection = { answerRequest: { schemaVersion: 1, mode: 'compile', questionRef: fixture.channels.get(fixture.a).taskRef,
      query: { ...semantic.request, limits: { records: 1 } }, quoteRefs: [semantic.ref(4)] }, quoteRoles: [['caller-source']] };
    const first = await fixture.host.plan(await fixture.request(), selection, fixture.a);
    assert.equal(first.mode, 'full'); assert.equal(first.target.entries.filter(entry => entry.representation === 'exact-source').length, 1);
    const quote = first.target.entries.find(entry => entry.representation === 'exact-source');
    assert.equal(first.bodies.find(body => body.id === quote.id).text, '0'); assert.equal(quote.source.sourceHash, semantic.source.byteHash);
    assert.deepEqual(first.target.unresolvedRoles, ['configuration']); assert.ok(first.target.continuation);
    const continuation = structuredClone(first.target.continuation);
    const retained = path.join(semantic.indexDir, 'semantic', 'semantic-sources', semantic.source.byteHash + '.utf8'), original = await fs.readFile(retained);
    try {
      await fs.writeFile(retained, original.toString('utf8').replace('0', '9'));
      await assert.rejects(fixture.host.apply(first.packetId, fixture.a), { code: 'ERR_SEMANTIC_INTEGRITY' });
      assert.equal((await fixture.host.describe(fixture.a)).actualWindowDigest, null, 'damaged retained bytes cannot acknowledge the source window');
    } finally { await fs.writeFile(retained, original); }
    const receipt = await fixture.host.apply(first.packetId, fixture.a); assert.equal(receipt.targetDigest, first.target.digest);
    assert.deepEqual((await fixture.host.redeliver(first.packetId, fixture.a)).target.continuation, continuation, 'revalidation never replaces the original opaque provider continuation');
    const next = await runRepositoryQuery({ ...selection.answerRequest.query, cursor: continuation.cursor });
    assert.ok(next.rows.length || next.cursor, 'the published original query capability remains usable');
    const forged = { ...selection, answerRequest: { ...selection.answerRequest, queryReceipt: {} } };
    assert.throws(() => provider.captureSelection(forged));
    assert.throws(() => provider.captureSelection({ ...selection, answerRequest: { ...selection.answerRequest, retention: { expectedBaseDigest: null } } }), { reason: 'RepresentationMismatch' });
  } finally { await semantic.cleanup(); }
} else {
  const semantic = await createRepositoryQuestionFixture();
  try {
    const input = { schemaVersion: 1, mode: 'compile', questionRef: { id: 'exact-projection', revision: '1' }, query: semantic.request, quoteRefs: [semantic.ref(4)] };
    const delivered = await runRepositoryAnswer(input); let opens = 0, closes = 0, failClose = true;
    const verify = createRepositoryAnswerEvidenceVerifier({ resolveIndexDir: async () => semantic.indexDir, openStore: async () => {
      opens++; return { store: semantic.artifact, close: async () => { closes++; if (failClose) throw 0; } };
    } });
    let rejected = false;
    try { await verify(input, delivered.answer); } catch (error) { rejected = true; assert.equal(error, 0); }
    assert.equal(rejected, true); assert.equal(opens, 1); assert.equal(closes, 1, 'failed query-reader close prevents source-reader admission');
    failClose = false; opens = 0; closes = 0;
    await verify(input, delivered.answer); assert.equal(opens, 2); assert.equal(closes, 2);
    const other = structuredClone(input); other.query.question.where.all.find(clause => clause.id === 'name').args[1] = 'other';
    await assert.rejects(verify(other, delivered.answer), { code: 'ERR_SEMANTIC_INTEGRITY' });
    assert.equal(opens, 2, 'a different logical/original question fails before artifact hydration');
  } finally { await semantic.cleanup(); }
}
console.log('Host evidence delivery advances visibility only after authenticated source revalidation, atomic replacement and exact readback.');
