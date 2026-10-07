#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { runNode } from '../../helpers/run-node.js';
import {
  BENCH_RUNTIME_LIVE_CANARY_STATUS,
} from '../../../tools/bench/language/canaries.js';
import {
  createCleanSdkBenchmarkReport,
  writeSdkTargetLiveSummary
} from './bench-runtime-fixture.js';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'bench', 'language-blocker-closure.js');
const { liveSummaryPath, outDir, sdkEntry, targetResult } = await writeSdkTargetLiveSummary({
  cacheName: 'bench-runtime-blocker-closure-evidence',
  root
});
const benchmarkReportPath = path.join(outDir, 'benchmark-report.json');
assert.ok(sdkEntry, 'expected sdk live canary entry');
assert.equal(targetResult.status, BENCH_RUNTIME_LIVE_CANARY_STATUS.TARGET_ACHIEVED, 'expected target fixture to satisfy live canary target');

const missingBenchmarkRun = runNode(
  [
    scriptPath,
    '--live-summary',
    liveSummaryPath,
    '--require-closure'
  ],
  'bench runtime blocker closure evidence without benchmark confirmation',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);
assert.notEqual(missingBenchmarkRun.status, 0, 'expected closure evidence to fail without a benchmark confirmation');
const missingBenchmarkEvidence = JSON.parse(missingBenchmarkRun.stdout);
assert.deepEqual(missingBenchmarkEvidence.blockedIssues, [379], 'expected sdk issue to remain blocked without benchmark confirmation');

const reportOutput = await createCleanSdkBenchmarkReport();
fs.writeFileSync(benchmarkReportPath, `${JSON.stringify(reportOutput, null, 2)}\n`);

const closureRun = runNode(
  [
    scriptPath,
    '--live-summary',
    liveSummaryPath,
    '--benchmark-report',
    benchmarkReportPath,
    '--require-closure'
  ],
  'bench runtime blocker closure evidence with benchmark confirmation',
  root,
  process.env,
  { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
);
assert.equal(closureRun.status, 0, closureRun.stderr || closureRun.stdout || 'expected closure evidence to pass once live and benchmark evidence are both present');
const closureEvidence = JSON.parse(closureRun.stdout);
assert.deepEqual(closureEvidence.blockedIssues, [], 'expected no blocked issues once closure evidence is complete');
assert.equal(closureEvidence.ok, true, 'expected closure evidence ok=true after benchmark confirmation');

console.log('bench runtime blocker closure evidence test passed');
