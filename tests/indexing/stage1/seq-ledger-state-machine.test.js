#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createSeqLedger, STAGE1_SEQ_STATE } from '../../../src/index/build/indexer/steps/process-files/ordering.js';

ensureTestingEnv(process.env);

const S = STAGE1_SEQ_STATE;
const ledger = createSeqLedger({ expectedSeqs: [10, 11, 12], leaseTimeoutMs: 25 });

assert.equal(ledger.getState(10), S.UNSEEN, 'expected initial state to start at UNSEEN');
assert.equal(ledger.getState(11), S.UNSEEN, 'expected every expected seq to start at UNSEEN');

ledger.transition(10, S.DISPATCHED, { ownerId: 1, nowMs: 1000 });
ledger.transition(10, S.IN_FLIGHT, { ownerId: 1, nowMs: 1001 });
assert.equal(ledger.heartbeat(10, 1, 1002), true, 'expected heartbeat for matching owner');
assert.equal(ledger.heartbeat(10, 2, 1003), false, 'expected heartbeat rejection for mismatched owner');
ledger.transition(10, S.TERMINAL_SUCCESS, { reasonCode: 0, nowMs: 1004 });
ledger.transition(10, S.COMMITTED, { nowMs: 1005 });

ledger.transition(11, S.DISPATCHED, { ownerId: 2, nowMs: 1006 });
ledger.transition(11, S.TERMINAL_CANCEL, { reasonCode: 42, nowMs: 1007 });
ledger.transition(11, S.COMMITTED, { nowMs: 1008 });

const seq12Slot = ledger.toSlot(12);
ledger.transition(12, S.DISPATCHED, { ownerId: 3, nowMs: 1009 });
ledger.transition(12, S.IN_FLIGHT, { ownerId: 3, nowMs: 1010 });
ledger.transition(12, S.TERMINAL_FAIL, { reasonCode: 77, nowMs: 1011 });
ledger.transition(12, S.DISPATCHED, { ownerId: 4, nowMs: 1012 });
ledger.transition(12, S.IN_FLIGHT, { ownerId: 4, nowMs: 1013 });
ledger.transition(12, S.TERMINAL_SUCCESS, { reasonCode: 0, nowMs: 1014 });
ledger.transition(12, S.COMMITTED, { nowMs: 1015 });

assert.equal(ledger.attempts[seq12Slot], 2, 'expected retries to increment attempts in the same seq slot');
assert.equal(ledger.terminalReason[seq12Slot], 0, 'expected terminal reason to match final terminal state');
assert.throws(
  () => ledger.transition(12, S.IN_FLIGHT),
  (error) => error?.code === 'STAGE1_SEQ_ILLEGAL_TRANSITION',
  'expected illegal transition rejection after COMMITTED terminalization'
);

ledger.assertCompletion();

const leaseLedger = createSeqLedger({ expectedSeqs: [50], leaseTimeoutMs: 5 });
leaseLedger.transition(50, S.DISPATCHED, { ownerId: 90, nowMs: 2000 });
leaseLedger.transition(50, S.IN_FLIGHT, { ownerId: 90, nowMs: 2000 });
const reclaimed = leaseLedger.reclaimExpiredLeases(2010);
assert.deepEqual(reclaimed, [50], 'expected expired in-flight lease reclaim');
assert.equal(leaseLedger.getState(50), S.TERMINAL_FAIL, 'expected reclaimed seq to hard-terminalize as fail');

console.log('stage1 seq ledger state machine test passed');
