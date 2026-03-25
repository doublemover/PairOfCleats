#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { runNode } from '../../helpers/run-node.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import {
  BENCH_RUNTIME_LIVE_CANARY_STATUS,
  buildBenchRuntimeLiveCanarySummary,
  loadBenchRuntimeCanaryManifest,
  runBenchRuntimeLiveCanary
} from '../../../tools/bench/language/canaries.js';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'bench', 'language-canaries.js');
const { dir: outDir } = await prepareTestCacheDir('bench-runtime-live-canary-closure');
const outJsonPath = path.join(outDir, 'summary.json');
const outMdPath = path.join(outDir, 'summary.md');

const baselineRun = runNode(
  [
    scriptPath,
    '--only',
    'sdk-artifact-tail-live',
    '--out-json',
    outJsonPath,
    '--out-md',
    outMdPath
  ],
  'bench runtime live canary lane',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.equal(baselineRun.status, 0, baselineRun.stderr || baselineRun.stdout || 'expected baseline canary lane to succeed');
const baselineSummary = JSON.parse(fs.readFileSync(outJsonPath, 'utf8'));
assert.equal(baselineSummary.ok, true, 'expected baseline canary lane summary ok=true without target requirement');
assert.deepEqual(baselineSummary.blockedIssues, [], 'expected no blocked issues without target requirement');
assert.equal(baselineSummary.environmentFingerprints.length >= 1, true, 'expected baseline summary to expose environment fingerprints');
assert.equal(fs.existsSync(outMdPath), true, 'expected markdown summary output');

const requireTargetRun = runNode(
  [
    scriptPath,
    '--only',
    'sdk-artifact-tail-live',
    '--require-target'
  ],
  'bench runtime live canary lane require-target',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);

assert.notEqual(requireTargetRun.status, 0, 'expected require-target mode to fail while blocker baseline remains unfixed');
const requireTargetSummary = JSON.parse(requireTargetRun.stdout);
assert.equal(requireTargetSummary.ok, false, 'expected require-target summary to fail');
assert.deepEqual(requireTargetSummary.blockedIssues, [379], 'expected blocker issue 379 to remain open in require-target mode');

const { manifest } = await loadBenchRuntimeCanaryManifest(root);
const sdkEntry = manifest.liveCanaries.find((entry) => entry.id === 'sdk-artifact-tail-live');
assert.ok(sdkEntry, 'expected sdk live canary entry');
const targetEntry = {
  ...sdkEntry,
  runner: {
    ...sdkEntry.runner,
    args: [
      '--fixture',
      'sdk-artifact-tail-live-target',
      '--out',
      '{outJson}'
    ]
  }
};

const targetResult = await runBenchRuntimeLiveCanary(targetEntry, root);
assert.equal(targetResult.status, BENCH_RUNTIME_LIVE_CANARY_STATUS.TARGET_ACHIEVED);
assert.equal(targetResult.closureReady, true, 'expected target fixture to satisfy closure contract');

const targetSummary = buildBenchRuntimeLiveCanarySummary([targetResult], { requireTarget: true });
assert.equal(targetSummary.ok, true, 'expected target-achieved summary to pass require-target mode');
assert.deepEqual(targetSummary.blockedIssues, [], 'expected no blocked issues once the target contract is satisfied');

console.log('bench runtime live canary closure test passed');
