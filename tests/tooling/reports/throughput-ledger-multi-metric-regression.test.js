#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  THROUGHPUT_LEDGER_SCHEMA_VERSION,
  computeThroughputLedgerRegression
} from '../../../tools/bench/language/metrics.js';

const createLedger = ({ chunksPerSec, filesPerSec, bytesPerSec, durationMs }) => ({
  schemaVersion: THROUGHPUT_LEDGER_SCHEMA_VERSION,
  modalities: {
    code: {
      mode: 'code',
      throughputKey: 'code',
      stages: {
        total: {
          chunksPerSec,
          filesPerSec,
          bytesPerSec,
          durationMs
        },
        parseChunk: {
          durationMs: Math.round(durationMs * 0.5)
        }
      }
    }
  }
});

const diff = computeThroughputLedgerRegression({
  currentLedger: createLedger({
    chunksPerSec: 80,
    filesPerSec: 8,
    bytesPerSec: 800,
    durationMs: 1500
  }),
  baselineLedgers: [
    createLedger({
      chunksPerSec: 100,
      filesPerSec: 10,
      bytesPerSec: 1000,
      durationMs: 1000
    }),
    createLedger({
      chunksPerSec: 110,
      filesPerSec: 11,
      bytesPerSec: 1100,
      durationMs: 900
    })
  ],
  metric: 'chunksPerSec'
});

assert.ok(diff && typeof diff === 'object', 'expected throughput ledger diff payload');
assert.equal(diff.metric, 'chunksPerSec');
assert.equal(diff.baselineCount, 2);
assert.equal(Array.isArray(diff.regressions), true);
assert.equal((diff.regressions || []).some((entry) => entry.metric === 'chunksPerSec'), true);
assert.equal(diff.metrics?.chunksPerSec?.regressions?.length >= 1, true, 'expected chunks/s regressions');
assert.equal(diff.metrics?.filesPerSec?.regressions?.length >= 1, true, 'expected files/s regressions');
assert.equal(diff.metrics?.bytesPerSec?.regressions?.length >= 1, true, 'expected bytes/s regressions');
assert.equal(diff.metrics?.durationMs?.regressions?.length >= 1, true, 'expected duration regressions');
assert.equal(
  diff.metrics?.durationMs?.regressions?.[0]?.metricKind,
  'duration',
  'expected duration metric kind'
);
assert.equal(
  diff.metrics?.chunksPerSec?.regressions?.[0]?.baselineConfidence,
  'medium',
  'expected confidence bucket based on baseline sample count'
);

console.log('throughput ledger multi metric regression test passed');
