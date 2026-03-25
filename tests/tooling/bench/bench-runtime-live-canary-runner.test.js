#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  BENCH_RUNTIME_LIVE_CANARY_STATUS,
  buildBenchRuntimeLiveCanarySummary,
  loadBenchRuntimeCanaryManifest,
  runBenchRuntimeLiveCanary
} from '../../../tools/bench/language/canaries.js';

const { manifest } = await loadBenchRuntimeCanaryManifest(process.cwd());

const results = [];
for (const entry of manifest.liveCanaries) {
  const result = await runBenchRuntimeLiveCanary(entry, process.cwd());
  results.push(result);
  assert.equal(result.id, entry.id, `expected result id for ${entry.id}`);
  assert.equal(result.ok, true, `expected baseline canary ${entry.id} to match current contract`);
  assert.equal(
    result.status,
    BENCH_RUNTIME_LIVE_CANARY_STATUS.BASELINE_CONFIRMED,
    `expected ${entry.id} to confirm the current blocker baseline`
  );
  assert.equal(result.closureReady, false, `expected ${entry.id} target contract to remain unmet`);
  assert.equal(result.current.ok, true, `expected current contract for ${entry.id}`);
  assert.equal(result.target.ok, false, `expected target contract for ${entry.id} to remain open`);
}

const summary = buildBenchRuntimeLiveCanarySummary(results, { requireTarget: false });
assert.equal(summary.ok, true, 'expected baseline lane to pass without target requirement');
assert.deepEqual(summary.blockedIssues, [], 'expected no blocked issues when only confirming baseline behavior');
assert.equal(
  summary.countsByStatus[ BENCH_RUNTIME_LIVE_CANARY_STATUS.BASELINE_CONFIRMED ],
  manifest.liveCanaries.length,
  'expected every blocker canary to confirm the current baseline'
);

console.log('bench runtime live canary runner test passed');
