#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';

ensureTestingEnv(process.env);

const output = await buildReportOutput({
  configPath: '/tmp/repos.json',
  cacheRoot: '/tmp/cache',
  resultsRoot: '/tmp/results',
  config: {
    javascript: { label: 'JavaScript' }
  },
  results: [
    {
      language: 'javascript',
      tier: 'small',
      repo: 'owner/passed',
      summary: {
        backends: ['memory'],
        latencyMsAvg: { memory: 4 },
        hitRate: { memory: 1 },
        resultCountAvg: { memory: 3 },
        memoryRss: { memory: { mean: 1024 } },
        buildMs: { index: 50 }
      }
    },
    {
      language: 'javascript',
      tier: 'small',
      repo: 'owner/degraded',
      summary: {
        backends: ['memory'],
        latencyMsAvg: { memory: 8 },
        hitRate: { memory: 0.9 },
        resultCountAvg: { memory: 2 },
        memoryRss: { memory: { mean: 1024 } },
        buildMs: { index: 70 }
      },
      diagnostics: {
        process: {
          countsByType: {
            fallback_used: 2,
            queue_delay_hotspot: 1
          }
        }
      }
    }
  ]
});

assert.ok(Array.isArray(output.tasks), 'expected task list in report output');
assert.equal(output.run.aggregateResultClass, 'passed_with_degradation', 'expected degradation-aware run verdict');
assert.equal(output.run.exitCode, 0, 'expected degradations to remain zero-exit by default');
assert.equal(output.run.repoCounts.passed, 1, 'expected one clean passing repo');
assert.equal(output.run.repoCounts.passedWithDegradation, 1, 'expected one degraded passing repo');
assert.equal(output.run.countsByDiagnosticType.fallback_used, 1, 'expected diagnostic type counted once at repo level');
assert.equal(output.run.countsByDiagnosticType.queue_delay_hotspot, 1, 'expected hotspot diagnostic counted once at repo level');

const degradedTask = output.tasks.find((entry) => entry.repo === 'owner/degraded');
assert.ok(degradedTask, 'expected degraded task payload');
assert.equal(degradedTask.taskStatus.resultClass, 'passed_with_degradation', 'expected degraded task class');
assert.deepEqual(
  degradedTask.taskStatus.degradationClasses,
  ['fallback_used', 'queue_delay_hotspot'],
  'expected degradation classes to be preserved'
);

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'bench-language-run-verdict');
const waiverPath = path.join(tempRoot, 'waivers.json');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.writeFile(
  waiverPath,
  JSON.stringify({
    schemaVersion: 1,
    policyVersion: 'bench-language-policy-v1',
    waivers: [
      {
        id: 'waive-benchmark-failure',
        owner: 'bench-owner',
        justification: 'fixture coverage for waived repo failure verdicts',
        allowedUntil: '2099-01-01T00:00:00.000Z',
        resultClass: 'repo_failed',
        failureClass: 'benchmark_failed',
        repo: 'owner/waived'
      }
    ]
  }, null, 2)
);

const waivedOutput = await buildReportOutput({
  configPath: '/tmp/repos.json',
  cacheRoot: '/tmp/cache',
  resultsRoot: '/tmp/results',
  waiverFile: waiverPath,
  config: {
    javascript: { label: 'JavaScript' }
  },
  results: [
    {
      language: 'javascript',
      tier: 'small',
      repo: 'owner/waived',
      failed: true,
      failureReason: 'bench',
      failureCode: 1
    }
  ]
});

assert.equal(
  waivedOutput.run.aggregateResultClass,
  'passed_with_degradation',
  'expected waived repo failures to downgrade aggregate result'
);
assert.equal(waivedOutput.run.exitCode, 0, 'expected waived repo failures to stay zero-exit');
assert.deepEqual(
  waivedOutput.run.policy.matchedWaiverIds,
  ['waive-benchmark-failure'],
  'expected matched waiver id to be recorded'
);
assert.equal(waivedOutput.run.issues.waivedCount, 1, 'expected one waived issue');

console.log('bench language run verdict test passed');
