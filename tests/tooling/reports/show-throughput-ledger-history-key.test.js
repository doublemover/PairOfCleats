#!/usr/bin/env node
import assert from 'node:assert/strict';

import { THROUGHPUT_LEDGER_SCHEMA_VERSION } from '../../../tools/bench/language/metrics.js';
import { applyRunThroughputLedgerDiffs } from '../../../tools/reports/show-throughput/analysis.js';

const createLedger = (chunksPerSec) => ({
  schemaVersion: THROUGHPUT_LEDGER_SCHEMA_VERSION,
  modalities: {
    code: {
      mode: 'code',
      throughputKey: 'code',
      stages: {
        total: {
          chunksPerSec
        }
      }
    }
  }
});

const runs = [
  {
    repoIdentity: 'PairOfCleats',
    repoHistoryKey: '/tmp/workspace-a/PairOfCleats',
    throughputLedger: createLedger(100)
  },
  {
    repoIdentity: 'PairOfCleats',
    repoHistoryKey: '/tmp/workspace-b/PairOfCleats',
    throughputLedger: createLedger(95)
  },
  {
    repoIdentity: 'PairOfCleats',
    repoHistoryKey: '/tmp/workspace-b/PairOfCleats',
    throughputLedger: createLedger(80)
  }
];

applyRunThroughputLedgerDiffs(runs);

assert.equal(runs[0].throughputLedgerDiff?.baselineCount, 0);
assert.equal(
  runs[1].throughputLedgerDiff?.baselineCount,
  0,
  'different history keys must not share baseline history even with equal display identity'
);
assert.equal(
  runs[2].throughputLedgerDiff?.baselineCount,
  1,
  'same history key should compare against prior ledger history'
);
assert.equal(runs[2].throughputLedgerDiff?.comparedEntries, 1);
assert.equal(runs[2].throughputLedgerDiff.regressions[0].baselineRate, 95);
assert.equal(runs[2].throughputLedgerDiff.regressions[0].deltaRate, -15);
assert.ok(Math.abs(runs[2].throughputLedgerDiff.regressions[0].deltaPct - (-0.15789473684210525)) < 1e-12);

console.log('show-throughput ledger history key test passed');
