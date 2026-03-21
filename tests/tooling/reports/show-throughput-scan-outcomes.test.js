#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-show-throughput-scan-outcomes-'));

try {
  const runRoot = path.join(tempRoot, 'workspace');
  const resultsDir = path.join(runRoot, 'benchmarks', 'results', 'mixed');
  await fs.mkdir(resultsDir, { recursive: true });

  const payload = {
    repo: { root: 'C:/repo/outcomes' },
    summary: {
      buildMs: { index: 50, sqlite: 25 },
      queryWallMsPerQuery: 2,
      queryWallMsPerSearch: 2,
      latencyMs: {
        memory: { mean: 1, p95: 2 },
        sqlite: { mean: 2, p95: 3 }
      },
      memoryRss: {
        memory: { mean: 100 * 1024 * 1024, p95: 150 * 1024 * 1024 },
        sqlite: { mean: 120 * 1024 * 1024, p95: 170 * 1024 * 1024 }
      }
    },
    artifacts: {
      repo: { root: 'C:/repo/outcomes', cacheRoot: 'C:/cache/outcomes' },
      throughput: {
        code: {
          files: 8,
          chunks: 24,
          tokens: 480,
          bytes: 4096,
          totalMs: 2000,
          writeMs: 400,
          filesPerSec: 4,
          chunksPerSec: 12,
          tokensPerSec: 240,
          bytesPerSec: 2048,
          writeBytesPerSec: 10240
        }
      },
      scanProfile: {
        schemaVersion: 1,
        generatedAt: '2026-03-21T00:00:00.000Z',
        source: 'report-artifacts',
        repo: { root: 'C:/repo/outcomes', cacheRoot: 'C:/cache/outcomes' },
        modes: {
          code: {
            mode: 'code',
            indexDir: 'C:/cache/outcomes/index-code',
            cache: { hits: 6, misses: 2, hitRate: 0.75 },
            files: {
              candidates: 8,
              scanned: 6,
              skipped: 2,
              skippedByReason: { binary: 1, minified: 1 }
            },
            chunks: { total: 24, avgTokens: 20 },
            tokens: { total: 480, vocab: 100 },
            lines: { total: 240, byLanguage: { javascript: 200, json: 40 } },
            bytes: { source: 8192, artifact: 4096 },
            artifacts: { filterIndex: { reused: true } },
            timings: {
              totalMs: 2000,
              writeMs: 400,
              watchdog: {
                queueDelayMs: {
                  summary: { count: 4, totalMs: 200, minMs: 20, maxMs: 80, avgMs: 50 }
                }
              }
            },
            throughput: {
              totalMs: 2000,
              writeMs: 400,
              filesPerSec: 4,
              chunksPerSec: 12,
              tokensPerSec: 240,
              bytesPerSec: 2048,
              linesPerSec: 120,
              writeBytesPerSec: 10240
            },
            queues: { postings: null },
            quality: { lowYieldBailout: null }
          },
          prose: {
            mode: 'prose',
            indexDir: null,
            cache: { hits: null, misses: null, hitRate: null },
            files: { candidates: null, scanned: null, skipped: null, skippedByReason: {} },
            chunks: { total: null, avgTokens: null },
            tokens: { total: null, vocab: null },
            lines: { total: null, byLanguage: {} },
            bytes: { source: null, artifact: null },
            artifacts: { filterIndex: null },
            timings: null,
            throughput: {
              totalMs: null, writeMs: null, filesPerSec: null, chunksPerSec: null, tokensPerSec: null,
              bytesPerSec: null, linesPerSec: null, writeBytesPerSec: null
            },
            queues: { postings: null },
            quality: { lowYieldBailout: null }
          },
          'extracted-prose': {
            mode: 'extracted-prose',
            indexDir: null,
            cache: { hits: 0, misses: 1, hitRate: 0 },
            files: { candidates: 4, scanned: 0, skipped: 4, skippedByReason: { low_yield: 4 } },
            chunks: { total: 0, avgTokens: 0 },
            tokens: { total: 0, vocab: 0 },
            lines: { total: 0, byLanguage: {} },
            bytes: { source: 0, artifact: 0 },
            artifacts: { filterIndex: null },
            timings: {
              totalMs: 100,
              writeMs: 20
            },
            throughput: {
              totalMs: 100, writeMs: 20, filesPerSec: 40, chunksPerSec: 0, tokensPerSec: 0,
              bytesPerSec: 0, linesPerSec: 0, writeBytesPerSec: 0
            },
            queues: { postings: null },
            quality: {
              lowYieldBailout: {
                enabled: true,
                triggered: true,
                reason: 'low_yield',
                qualityImpact: 'reduced-extracted-prose-recall',
                seed: 'fixture',
                warmupWindowSize: 8,
                warmupSampleSize: 4,
                sampledFiles: 4,
                sampledYieldedFiles: 0,
                sampledChunkCount: 0,
                observedYieldRatio: 0,
                minYieldRatio: 0.25,
                minYieldedFiles: 1,
                suppressedCohortCount: 1,
                protectedCohortCount: 0,
                strategyMismatchRiskCount: 0,
                skippedFiles: 4,
                decisionAtOrderIndex: 4,
                decisionAt: '2026-03-21T00:00:01.000Z',
                repoFingerprint: {
                  totalEntries: 4,
                  docLikeEntries: 1,
                  dominantCohort: 'docs',
                  cohortCounts: { docs: 1 }
                },
                suppressedCohorts: [],
                protectedCohorts: [],
                strategyMismatchRiskCohorts: [],
                deterministic: true,
                downgradedRecall: true
              }
            }
          },
          records: {
            mode: 'records',
            indexDir: null,
            cache: { hits: null, misses: null, hitRate: null },
            files: { candidates: null, scanned: null, skipped: null, skippedByReason: {} },
            chunks: { total: null, avgTokens: null },
            tokens: { total: null, vocab: null },
            lines: { total: null, byLanguage: {} },
            bytes: { source: null, artifact: null },
            artifacts: { filterIndex: null },
            timings: null,
            throughput: {
              totalMs: null, writeMs: null, filesPerSec: null, chunksPerSec: null, tokensPerSec: null,
              bytesPerSec: null, linesPerSec: null, writeBytesPerSec: null
            },
            queues: { postings: null },
            quality: { lowYieldBailout: null }
          }
        },
        totals: {
          files: { candidates: 12, scanned: 6, skipped: 6 },
          chunks: 24,
          tokens: 480,
          lines: 240,
          bytes: { source: 8192, artifact: 4096 },
          durationMs: 2100,
          filesPerSec: 5.7,
          chunksPerSec: 11.4,
          tokensPerSec: 228.6,
          bytesPerSec: 1950,
          linesPerSec: 114.3
        },
        languageLines: { javascript: 200, json: 40 }
      }
    }
  };

  await fs.writeFile(path.join(resultsDir, 'fixture.json'), JSON.stringify(payload, null, 2));

  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'tools', 'reports', 'show-throughput.js')],
    { cwd: runRoot, encoding: 'utf8', env: process.env }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(String(result.stderr || '').trim(), '', 'expected overview text on stdout only');
  const output = String(result.stdout || '').replace(/\u001b\[[0-9;]*m/g, '');
  assert.equal(output.includes('Coverage'), true);
  assert.equal(output.includes('Repos          12        6        6'), true);
  assert.equal(output.includes('low_yield 4'), true);
  assert.equal(output.includes('binary 1'), true);
  assert.equal(output.includes('minified 1'), true);
  assert.equal(output.includes('hits 6 | misses 3 | hit 66.7%'), true);
  assert.equal(output.includes('low-yield 1 (4 skipped)'), true);
  assert.equal(output.includes('filter-index reused 1'), true);
  assert.equal(output.includes('queue avg/max 50ms/80ms'), true);

  console.log('show-throughput scan outcomes test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
