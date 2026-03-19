#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';

ensureTestingEnv(process.env);

const buildStageTimingProfile = ({
  scanMs = 0,
  schedulerMs = 0,
  artifactCloseoutMs = 0,
  sqliteMs = 0
} = {}) => ({
  schemaVersion: 1,
  stages: {
    discovery: Math.floor(scanMs / 3),
    importScan: Math.floor(scanMs / 3),
    scmMeta: scanMs - (Math.floor(scanMs / 3) * 2),
    parseChunk: 0,
    inference: 0,
    artifactWrite: artifactCloseoutMs,
    embedding: 0,
    sqliteBuild: sqliteMs
  },
  stageTotalMs: scanMs + artifactCloseoutMs + sqliteMs,
  breakdown: {
    parseChunk: { totalMs: 0, byLanguage: {}, bySizeBin: {} },
    inference: { totalMs: 0, byLanguage: {}, bySizeBin: {} },
    embedding: { totalMs: 0, byLanguage: {}, bySizeBin: {} }
  },
  watchdog: {
    queueDelayMs: {
      summary: {
        count: schedulerMs > 0 ? 1 : 0,
        totalMs: schedulerMs,
        minMs: schedulerMs,
        maxMs: schedulerMs,
        avgMs: schedulerMs
      },
      histogram: {
        bucketsMs: [],
        counts: [],
        overflow: 0
      }
    }
  }
});

const output = await buildReportOutput({
  configPath: '/tmp/repos.json',
  cacheRoot: '/tmp/cache',
  resultsRoot: '/tmp/results',
  methodology: {
    mode: 'warm',
    cacheMode: 'warm',
    toolingMode: 'disabled',
    corpusVersion: 'repos-fixture',
    policyVersion: 'bench-language-methodology-v1',
    controlSlice: { taskIds: [] }
  },
  config: {
    python: { label: 'Python' },
    shell: { label: 'Shell' },
    rust: { label: 'Rust' }
  },
  results: [
    {
      language: 'python',
      tier: 'large',
      repo: 'django/django',
      summary: {
        backends: ['memory', 'sqlite'],
        latencyMsAvg: { memory: 8, sqlite: 15 },
        hitRate: { memory: 0.55, sqlite: 0.61 },
        resultCountAvg: { memory: 3, sqlite: 3 },
        memoryRss: {
          memory: { mean: 1024 },
          sqlite: { mean: 1900 * 1024 * 1024 }
        },
        buildMs: { index: 280000, sqlite: 85000 }
      },
      diagnostics: {
        process: {
          countsByType: {
            artifact_tail_stall: 3,
            queue_delay_hotspot: 1
          }
        }
      },
      stageTimingProfile: buildStageTimingProfile({
        scanMs: 55000,
        schedulerMs: 4000,
        artifactCloseoutMs: 140000,
        sqliteMs: 85000
      })
    },
    {
      language: 'shell',
      tier: 'medium',
      repo: 'ohmyzsh/ohmyzsh',
      summary: {
        backends: ['memory', 'sqlite'],
        latencyMsAvg: { memory: 5, sqlite: 10 },
        hitRate: { memory: 0.6, sqlite: 0.58 },
        resultCountAvg: { memory: 2, sqlite: 2 },
        memoryRss: {
          memory: { mean: 1024 },
          sqlite: { mean: 1250 * 1024 * 1024 }
        },
        buildMs: { index: 220000, sqlite: 45000 }
      },
      diagnostics: {
        process: {
          countsByType: {
            queue_delay_hotspot: 2
          }
        }
      },
      stageTimingProfile: buildStageTimingProfile({
        scanMs: 90000,
        schedulerMs: 65000,
        artifactCloseoutMs: 25000,
        sqliteMs: 45000
      })
    },
    {
      language: 'rust',
      tier: 'small',
      repo: 'rust-lang/cargo',
      summary: {
        backends: ['memory', 'sqlite'],
        latencyMsAvg: { memory: 4, sqlite: 7 },
        hitRate: { memory: 0.91, sqlite: 0.82 },
        resultCountAvg: { memory: 3, sqlite: 3 },
        memoryRss: {
          memory: { mean: 1024 },
          sqlite: { mean: 700 * 1024 * 1024 }
        },
        buildMs: { index: 90000, sqlite: 20000 }
      },
      stageTimingProfile: buildStageTimingProfile({
        scanMs: 70000,
        schedulerMs: 3000,
        artifactCloseoutMs: 12000,
        sqliteMs: 20000
      })
    }
  ]
});

assert.equal(output.overallSummary?.reuse?.mode, 'warm', 'expected reuse summary mode');
assert.equal(output.overallSummary?.reuse?.coldStart?.averageHitRate, null, 'expected cold-start lane to be disabled for warm mode');
assert.equal(output.overallSummary?.reuse?.intraRun?.averageHitRate, 0.6867, 'expected intra-run reuse average');
assert.equal(output.overallSummary?.reuse?.crossRun?.averageHitRate, 0.67, 'expected cross-run reuse average');
assert.equal(output.ownership?.policyVersion, 'bench-language-family-ownership-v1', 'expected ownership policy version');

const scriptingFamily = output.ownership?.families?.find((entry) => (
  Array.isArray(entry?.topOffenders)
  && entry.topOffenders.some((repo) => repo.repo === 'django/django')
));
assert.ok(scriptingFamily, 'expected scripting family ownership summary');
assert.equal(scriptingFamily.phaseOwnership?.dominantPhase, 'artifactCloseout', 'expected artifact closeout dominant phase for scripting family');
assert.equal(scriptingFamily.guardrails?.breachedCount >= 4, true, 'expected multiple scripting budget breaches');
assert.equal(scriptingFamily.reuse?.intraRun?.guardrail?.status, 'breached', 'expected intra-run reuse guardrail breach');
assert.equal(scriptingFamily.rss?.guardrail?.status, 'breached', 'expected sqlite RSS guardrail breach');
assert.equal(
  scriptingFamily.topOffenders[0]?.issues.includes('artifact_tail_stall'),
  true,
  'expected top offender to capture artifact closeout issue'
);

console.log('bench language ownership test passed');
