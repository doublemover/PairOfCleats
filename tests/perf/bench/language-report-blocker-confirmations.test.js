#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { createCleanSdkBenchmarkReport } from '../../tooling/bench/bench-runtime-fixture.js';

ensureTestingEnv(process.env);

const cleanOutput = await createCleanSdkBenchmarkReport();

const cleanConfirmation = cleanOutput.blockerConfirmations?.summary?.canaries?.find((entry) => entry.id === 'sdk-artifact-tail-live');
assert.ok(cleanConfirmation, 'expected blocker confirmation entry for sdk');
assert.equal(cleanConfirmation.benchmarkConfirmed, true, 'expected clean sdk benchmark run to satisfy blocker confirmation');
assert.equal(cleanConfirmation.taskStatus?.resultClass, 'passed', 'expected clean task result class to be preserved');

const degradedOutput = await buildReportOutput({
  configPath: '/tmp/repos.json',
  cacheRoot: '/tmp/cache',
  resultsRoot: '/tmp/results',
  runLabel: 'bench-language medium',
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
        latencyMsAvg: { memory: 8 },
        hitRate: { memory: 0.8 },
        resultCountAvg: { memory: 2 },
        memoryRss: { memory: { mean: 1024 } },
        buildMs: { index: 70 }
      },
      diagnostics: {
        process: {
          countsByType: {
            artifact_tail_stall: 2
          },
          countsBySeverity: {
            warn: 1
          }
        }
      }
    }
  ]
});

const degradedConfirmation = degradedOutput.blockerConfirmations?.summary?.canaries?.find((entry) => entry.id === 'sdk-artifact-tail-live');
assert.ok(degradedConfirmation, 'expected degraded blocker confirmation entry for sdk');
assert.equal(degradedConfirmation.benchmarkConfirmed, false, 'expected artifact tail stall run to fail blocker confirmation');
assert.ok(
  degradedConfirmation.targetFailures.some((entry) => entry.includes('artifact_tail_stall')),
  'expected target failures to explain the failed confirmation'
);

console.log('bench language report blocker confirmations test passed');
