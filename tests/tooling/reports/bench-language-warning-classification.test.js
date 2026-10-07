#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBenchDiagnosticClassifier } from '../../../tools/bench/language/logging.js';

const classifier = createBenchDiagnosticClassifier();

const classify = (message) => classifier.classify({
  event: {
    level: 'warn',
    message
  },
  source: 'stdout'
});

const rustToolchainNoiseSignals = classify(
  '[tooling] rust-analyzer suppressed 2 duplicate workspace stderr line(s); repo-invalidity=0, toolchain-noise=2'
);
assert.deepEqual(rustToolchainNoiseSignals, [], 'expected pure rust toolchain-noise suppression to stay out of bench warning debt');

const rustRepoInvaliditySignals = classify(
  '[tooling] rust-analyzer suppressed 2 duplicate workspace stderr line(s); repo-invalidity=1, toolchain-noise=1'
);
assert.equal(rustRepoInvaliditySignals.length, 1, 'expected repo-invalidity rust suppression to remain actionable');
assert.equal(rustRepoInvaliditySignals[0]?.failureClass, 'stderr:duplicate workspace');

const nonActionableImportsSignals = classify(
  '[imports] suppression: policy=live count=4 degraded=0 visible=0 total=4 actionable=0 omittedFailureCauses=parser_artifact'
);
assert.deepEqual(nonActionableImportsSignals, [], 'expected non-actionable live import suppression to stay out of warning debt');

const actionableImportsSignals = classify(
  '[imports] suppression: policy=live count=1 degraded=1 visible=2 total=10 actionable=2 omittedFailureCauses=generated_expected_missing,missing_file,parser_artifact'
);
assert.equal(actionableImportsSignals.length, 1, 'expected degraded/actionable import suppression to remain a warning signal');
assert.equal(actionableImportsSignals[0]?.failureClass, 'imports_live:1');
assert.equal(actionableImportsSignals[0]?.actionableCount, 2);

const legacyPolicySignals = classify(
  '[imports] all captured unresolved samples were suppressed by live policy (4).'
);
assert.deepEqual(legacyPolicySignals, [], 'expected legacy live-policy summary line to avoid duplicate warning debt');

const legacyCountSignals = classify(
  '[imports] suppressed 5 import resolution warnings.'
);
assert.deepEqual(legacyCountSignals, [], 'expected legacy warning-count summary line to avoid duplicate warning debt');

console.log('bench language warning classification test passed');
