#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import {
  THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION,
  THROUGHPUT_LEDGER_SCHEMA_VERSION
} from '../../../tools/bench/language/metrics.js';
import { BENCH_PROGRESS_CONFIDENCE_SCHEMA_VERSION, computeBenchProgressConfidence,
  qualifyBenchProgressObservation } from '../../../tools/bench/language/logging.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-language-throughput-ledger-report');
const logsRoot = path.join(tempRoot, 'logs', 'bench-language');
const runDir = path.join(tempRoot, 'runs');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(logsRoot, { recursive: true });
await fsPromises.mkdir(runDir, { recursive: true });

const now = Date.now();
const confidenceStream = path.join(logsRoot, 'run-ub098-all.progress-confidence.jsonl');
await fsPromises.writeFile(
  confidenceStream,
  [0.92, 0.63, 0.24].map((score, index) => {
    const at = now + index * 1000;
    const measured = computeBenchProgressConfidence({ heartbeatRegularityScore: score, queueAgeScore: score,
      inFlightSpreadScore: score, stallEventsScore: score, heartbeatSamples: 2, queueSamples: 2, inFlightSamples: 2, stallSamples: 2 });
    return JSON.stringify({ ...qualifyBenchProgressObservation(measured, { nowMs: at, firstObservedAtMs: now - 1,
      lastObservedAtMs: at, phase: 'tokenize', taskId: 'code' }), ts: new Date(at).toISOString(),
    label: 'bench javascript owner/repo', reason: index === 2 ? 'queue_delay_hotspot' : 'task:progress' });
  }).join('\n') + '\n',
  'utf8'
);

const repoRoot = path.join(tempRoot, 'repo');
await fsPromises.mkdir(repoRoot, { recursive: true });
const outFileBaseline = path.join(runDir, 'owner__repo-baseline.json');
const outFileCurrent = path.join(runDir, 'owner__repo-current.json');

const writeBenchPayload = async (outFile, { generatedAt, chunks, tokens, bytes }) => {
  await fsPromises.writeFile(
    outFile,
    JSON.stringify({
      generatedAt,
      repo: { root: repoRoot },
      summary: {
        backends: ['memory'],
        latencyMsAvg: { memory: 2 },
        hitRate: { memory: 0.9 },
        resultCountAvg: { memory: 2 },
        memoryRss: { memory: { mean: 2 * 1024 * 1024 } },
        buildMs: { index: 1200, sqlite: 220 }
      },
      artifacts: {
        throughput: {
          code: {
            files: 4,
            chunks,
            tokens,
            bytes,
            totalMs: 1000
          }
        }
      }
    }, null, 2),
    'utf8'
  );
};

await writeBenchPayload(outFileBaseline, {
  generatedAt: new Date(now + 10_000).toISOString(),
  chunks: 200,
  tokens: 2000,
  bytes: 20_000
});
await writeBenchPayload(outFileCurrent, {
  generatedAt: new Date(now + 20_000).toISOString(),
  chunks: 100,
  tokens: 900,
  bytes: 10_000
});

const resultEntries = [
  {
    language: 'javascript',
    tier: 'tiny',
    repo: 'owner/repo',
    repoPath: repoRoot,
    outFile: outFileBaseline,
    summary: {
      backends: ['memory'],
      latencyMsAvg: { memory: 2 },
      hitRate: { memory: 0.9 },
      resultCountAvg: { memory: 2 },
      memoryRss: { memory: { mean: 2 * 1024 * 1024 } },
      buildMs: { index: 1200, sqlite: 220 }
    }
  },
  {
    language: 'javascript',
    tier: 'tiny',
    repo: 'owner/repo',
    repoPath: repoRoot,
    outFile: outFileCurrent,
    summary: {
      backends: ['memory'],
      latencyMsAvg: { memory: 2 },
      hitRate: { memory: 0.9 },
      resultCountAvg: { memory: 2 },
      memoryRss: { memory: { mean: 2 * 1024 * 1024 } },
      buildMs: { index: 1300, sqlite: 240 }
    }
  }
];

const output = await buildReportOutput({
  configPath: path.join(tempRoot, 'repos.json'),
  cacheRoot: path.join(tempRoot, 'cache'),
  resultsRoot: tempRoot,
  results: resultEntries,
  config: {
    javascript: { label: 'JavaScript' }
  }
});

assert.equal(
  output.tasks[0]?.throughputLedger?.schemaVersion,
  THROUGHPUT_LEDGER_SCHEMA_VERSION,
  'expected throughput ledger on task output'
);
assert.equal(
  output.tasks[1]?.throughputLedgerDiff?.schemaVersion,
  THROUGHPUT_LEDGER_DIFF_SCHEMA_VERSION,
  'expected throughput ledger diff on later run for same repo'
);
assert.equal(
  output.tasks[1]?.throughputLedgerDiff?.baselineCount,
  1,
  'expected baseline ledger history for repo regression diff'
);
assert.equal(
  (output.tasks[1]?.throughputLedgerDiff?.regressions || []).some((entry) => (
    entry.modality === 'code' && entry.stage === 'total' && Number(entry.deltaPct) < 0
  )),
  true,
  'expected regression detection for degraded code throughput'
);
assert.equal(
  (output?.throughputLedger?.topRegressions || []).length >= 1,
  true,
  'expected report-level top throughput regressions list'
);

const confidence = output?.diagnostics?.progressConfidence;
assert.ok(confidence && typeof confidence === 'object', 'expected progress confidence report summary');
assert.equal(confidence.schemaVersion, BENCH_PROGRESS_CONFIDENCE_SCHEMA_VERSION, 'expected confidence schema version');
assert.equal(confidence.fileCount, 1, 'expected one confidence stream file');
assert.equal(confidence.eventCount, 3, 'expected confidence events to be counted');
assert.equal(confidence.countsByBucket.high, 1, 'expected high bucket count');
assert.equal(confidence.countsByBucket.medium, 1, 'expected medium bucket count');
assert.equal(confidence.countsByBucket.low, 1, 'expected low bucket count');
assert.equal(
  confidence.latestByLabel[0]?.bucket,
  'low',
  'expected latest confidence snapshot per label'
);

await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('bench language throughput ledger report test passed');
