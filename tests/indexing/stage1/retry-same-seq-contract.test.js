#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createSeqLedger, STAGE1_SEQ_STATE } from '../../../src/index/build/indexer/steps/process-files/ordering.js';

ensureTestingEnv(process.env);

const S = STAGE1_SEQ_STATE;
const ledger = createSeqLedger({
  expectedSeqs: [0, 1]
});

const retrySlot = ledger.toSlot(1);
assert.ok(retrySlot >= 0, 'expected retry seq slot to exist');

ledger.transition(0, S.DISPATCHED, { ownerId: 10, nowMs: 1 });
ledger.transition(0, S.IN_FLIGHT, { ownerId: 10, nowMs: 2 });

ledger.transition(1, S.DISPATCHED, { ownerId: 11, nowMs: 3 });
ledger.transition(1, S.IN_FLIGHT, { ownerId: 11, nowMs: 4 });
ledger.transition(1, S.TERMINAL_FAIL, { reasonCode: 700, nowMs: 5 });
ledger.transition(1, S.DISPATCHED, { ownerId: 12, nowMs: 6 });
ledger.transition(1, S.IN_FLIGHT, { ownerId: 12, nowMs: 7 });
ledger.transition(1, S.TERMINAL_SUCCESS, { reasonCode: 0, nowMs: 8 });

assert.equal(ledger.toSlot(1), retrySlot, 'expected retry to reuse original seq slot');
assert.equal(ledger.attempts[retrySlot], 2, 'expected retry attempts to remain per-seq bounded counters');
assert.equal(ledger.terminalReason[retrySlot], 0, 'expected final terminal reason to track final retry result');

ledger.transition(0, S.TERMINAL_SUCCESS, { reasonCode: 0, nowMs: 9 });
ledger.transition(0, S.COMMITTED, { nowMs: 10 });
ledger.transition(1, S.COMMITTED, { nowMs: 11 });
ledger.assertCompletion();

console.log('stage1 retry same-seq contract test passed');
