import assert from 'node:assert/strict';
import { createSeqLedger, STAGE1_SEQ_STATE as S } from '../../../src/index/build/indexer/steps/process-files/ordering.js';
import { buildOrderedAppender, replayCommitJournal } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

const ids = [7, 2 ** 40, 2 ** 48];
const ledger = createSeqLedger({ expectedSeqs: [...ids].reverse(), leaseTimeoutMs: 5 });
for (const key of ['states', 'attempts', 'leaseOwner', 'leaseHeartbeat', 'terminalReason']) {
  assert.equal(ledger[key].length, ids.length, `${key} must scale with actual work, never sequence span`);
}
assert.equal(ledger.toSlot(ids[1]), 1);
assert.equal(ledger.toSlot(8), -1);
assert.equal(ledger.nextExpectedSeq(ids[0]), ids[1]);
assert.equal(ledger.nextExpectedSeq(8), null);
ledger.transition(ids[2], S.DISPATCHED, { ownerId: 1, nowMs: 100 });
ledger.transition(ids[2], S.IN_FLIGHT, { ownerId: 1, nowMs: 100 });
assert.deepEqual(ledger.reclaimExpiredLeases(110), [ids[2]], 'reclaim returns source IDs, not compact slots');
ledger.transition(ids[2], S.DISPATCHED, { ownerId: 2, nowMs: 111 });
ledger.resetNonTerminal(ids[2]);
assert.equal(ledger.getState(ids[2]), S.UNSEEN);
assert.equal(ledger.snapshot().nextCommitSeq, ids[0]);

const applied = [];
let release;
const blocked = new Promise(resolve => { release = resolve; });
const appender = buildOrderedAppender(async (result, _state, _shard, context) => {
  if (context.orderIndex === ids[0]) await blocked;
  applied.push([context.orderIndex, result.value]);
}, {}, { expectedIndices: ids, maxPendingBytes: 1, commitLagHard: 2 });
const pending = [appender.enqueue(ids[2], { value: 'last' }),
  appender.enqueue(ids[1], { value: 'middle' }),
  appender.enqueue(ids[1], { value: 'duplicate' }),
  appender.enqueue(ids[0], { value: 'first' })];
assert.equal(appender.snapshot().commitLag, 2, 'backpressure uses pending ordinals, not numeric holes');
await appender.waitForCapacity({ orderIndex: ids[1], bypassWindow: 1, timeoutMs: 100 });
release(); await Promise.all(pending);
assert.deepEqual(applied, [[ids[0], 'first'], [ids[1], 'middle'], [ids[2], 'last']]);
appender.assertCompletion();

const replay = replayCommitJournal([{ seq: ids[0], recordType: 'commit' }], { expectedSeqs: ids });
assert.equal(replay.nextCommitSeq, ids[1]);
assert.equal(replayCommitJournal(ids.map(seq => ({ seq, recordType: 'commit' })), { expectedSeqs: ids }).nextCommitSeq, ids[2] + 1);
const aborted = buildOrderedAppender(async () => {}, {}, { expectedIndices: ids });
const rejected = assert.rejects(aborted.enqueue(ids[2], { value: 'waiting' }), /stop/);
aborted.abort(new Error('stop')); await rejected;
assert.equal(aborted.snapshot().terminalCount, ids.length, 'cancellation visits only actual expected sequences');

const exhausted = createSeqLedger({ expectedSeqs: [1] });
exhausted.attempts[0] = 65535;
assert.throws(() => exhausted.transition(1, S.DISPATCHED), { code: 'STAGE1_SEQ_ATTEMPT_LIMIT' });
assert.equal(exhausted.getState(1), S.UNSEEN, 'attempt exhaustion cannot recycle a stale lease identity');
assert.throws(() => createSeqLedger({ expectedSeqs: [Number.MAX_SAFE_INTEGER] }), RangeError);
assert.throws(() => replayCommitJournal([], { expectedSeqs: [Number.MAX_SAFE_INTEGER] }), RangeError);
console.log('Compact sparse Stage1 resume slots, replay, backpressure, cancellation and attempt fencing passed');
