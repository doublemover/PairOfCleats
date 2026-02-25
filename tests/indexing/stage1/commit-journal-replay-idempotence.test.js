#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { replayCommitJournal } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

ensureTestingEnv(process.env);

const journal = [
  { seq: 1, recordType: 'terminal', terminalOutcome: 'success' },
  { seq: 2, recordType: 'terminal', terminalOutcome: 'skip' },
  { seq: 3, recordType: 'terminal', terminalOutcome: 'fail' },
  { seq: 0, recordType: 'terminal', terminalOutcome: 'success' },
  { seq: 0, recordType: 'commit', terminalOutcome: 'success' },
  { seq: 1, recordType: 'commit', terminalOutcome: 'success' },
  { seq: 2, recordType: 'commit', terminalOutcome: 'skip' },
  { seq: 3, recordType: 'commit', terminalOutcome: 'fail' }
];
const expectedSeqs = [0, 1, 2, 3];

const replayA = replayCommitJournal(journal, { expectedSeqs });
const replayB = replayCommitJournal([...journal, ...journal], { expectedSeqs });

assert.deepEqual(replayA.committedSeqs, expectedSeqs, 'expected replay to recover committed contiguous seq set');
assert.equal(replayA.nextCommitSeq, 4, 'expected replay cursor at terminal seq tail');
assert.deepEqual(replayB, replayA, 'expected replay idempotence under duplicate journal records');

assert.throws(
  () => replayCommitJournal(
    [
      { seq: 0, recordType: 'terminal', terminalOutcome: 'success' },
      { seq: 0, recordType: 'terminal', terminalOutcome: 'fail' }
    ],
    { expectedSeqs: [0] }
  ),
  (error) => error?.code === 'STAGE1_COMMIT_JOURNAL_CONFLICT',
  'expected replay hard-fail on conflicting terminal outcomes for same seq'
);

console.log('stage1 commit journal replay idempotence test passed');
