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
import { buildReportOutput } from '../../../tools/bench/language/report.js';

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'bench', 'language-blocker-closure.js');
const { dir: outDir } = await prepareTestCacheDir('bench-runtime-blocker-closure-evidence');
const liveSummaryPath = path.join(outDir, 'live-summary.json');
const benchmarkReportPath = path.join(outDir, 'benchmark-report.json');

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
assert.equal(targetResult.status, BENCH_RUNTIME_LIVE_CANARY_STATUS.TARGET_ACHIEVED, 'expected target fixture to satisfy live canary target');
const liveSummary = buildBenchRuntimeLiveCanarySummary([targetResult], { requireTarget: true });
fs.writeFileSync(liveSummaryPath, `${JSON.stringify(liveSummary, null, 2)}\n`);

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

const reportOutput = await buildReportOutput({
  configPath: '/tmp/repos.json',
  cacheRoot: '/tmp/cache',
  resultsRoot: '/tmp/results',
  runLabel: 'bench-language small',
  config: {
    python: { label: 'Python' }
  },
  results: [
    {
      language: 'python',
      tier: 'medium',
      repo: 'basedosdados/sdk',
      summary: {
        backends: ['memory'],
        latencyMsAvg: { memory: 4 },
        hitRate: { memory: 1 },
        resultCountAvg: { memory: 3 },
        memoryRss: { memory: { mean: 1024 } },
        buildMs: { index: 50 }
      }
    }
  ]
});
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
