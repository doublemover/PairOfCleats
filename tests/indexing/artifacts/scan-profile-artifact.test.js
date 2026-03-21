#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateArtifact } from '../../../src/shared/artifact-schemas.js';
import { buildScanProfile } from '../../../tools/index/report-artifacts/scan-profile.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-scan-profile-artifact-'));

try {
  const extractedIndexDir = path.join(tempRoot, 'index-extracted-prose');
  await fs.mkdir(extractedIndexDir, { recursive: true });
  await fs.writeFile(
    path.join(extractedIndexDir, 'extraction_report.json'),
    JSON.stringify({
      schemaVersion: 1,
      mode: 'extracted-prose',
      generatedAt: '2026-03-21T00:00:00.000Z',
      chunkerVersion: 'test',
      extractionConfigDigest: 'digest',
      quality: {
        lowYieldBailout: {
          enabled: true,
          triggered: true,
          reason: 'low_yield',
          qualityImpact: 'reduced-extracted-prose-recall',
          seed: 'fixture-seed',
          warmupWindowSize: 8,
          warmupSampleSize: 4,
          sampledFiles: 4,
          sampledYieldedFiles: 0,
          sampledChunkCount: 0,
          observedYieldRatio: 0,
          minYieldRatio: 0.25,
          minYieldedFiles: 1,
          suppressedCohortCount: 1,
          protectedCohortCount: 1,
          strategyMismatchRiskCount: 0,
          skippedFiles: 4,
          decisionAtOrderIndex: 4,
          decisionAt: '2026-03-21T00:00:01.000Z',
          repoFingerprint: {
            totalEntries: 4,
            docLikeEntries: 1,
            dominantCohort: 'docs',
            cohortCounts: { docs: 1, tests: 3 }
          },
          suppressedCohorts: [
            {
              key: 'tests',
              suppressionClass: 'low-value',
              expectedYieldClass: 'low',
              warmupFiles: 3,
              sampledFiles: 3,
              sampledObservedFiles: 3,
              sampledYieldedFiles: 0,
              sampledChunkCount: 0
            }
          ],
          protectedCohorts: [
            {
              key: 'docs',
              expectedYieldClass: 'high',
              strategyMismatchRisk: false,
              protectedBySample: false,
              protectedByHistory: true,
              protectedByPriority: true
            }
          ],
          strategyMismatchRiskCohorts: [],
          deterministic: true,
          downgradedRecall: true
        }
      },
      counts: {
        total: 4,
        ok: 0,
        skipped: 4,
        byReason: { low_yield: 4 }
      },
      extractors: [],
      files: []
    }, null, 2)
  );

  const payload = buildScanProfile({
    artifactReport: {
      repo: {
        root: 'C:/repo',
        cacheRoot: 'C:/cache',
        artifacts: {
          indexCode: 256,
          indexExtractedProse: 128
        }
      }
    },
    indexMetrics: {
      code: {
        indexDir: path.join(tempRoot, 'index-code'),
        cache: { hits: 2, misses: 1, hitRate: 2 / 3 },
        files: {
          scanned: 3,
          skipped: 1,
          candidates: 4,
          skippedByReason: { minified: 1 }
        },
        chunks: {
          total: 6,
          avgTokens: 8.5
        },
        tokens: {
          total: 51,
          vocab: 20
        },
        queues: {
          postings: { depth: 2 }
        },
        timings: {
          totalMs: 1200,
          writeMs: 300
        }
      },
      extractedProse: {
        indexDir: extractedIndexDir,
        cache: { hits: 0, misses: 2, hitRate: 0 },
        files: {
          scanned: 0,
          skipped: 4,
          candidates: 4,
          skippedByReason: { low_yield: 4 }
        },
        chunks: {
          total: 0,
          avgTokens: 0
        },
        tokens: {
          total: 0,
          vocab: 0
        },
        queues: {
          postings: null
        },
        timings: {
          totalMs: 200,
          writeMs: 50
        }
      }
    },
    featureMetrics: {
      modes: {
        code: {
          totals: {
            count: 4,
            lines: 42,
            bytes: 420,
            durationMs: 1200
          },
          languages: {
            python: { lines: 40 },
            unknown: { lines: 2 }
          }
        },
        'extracted-prose': {
          totals: {
            count: 4,
            lines: 12,
            bytes: 96,
            durationMs: 200
          },
          languages: {
            markdown: { lines: 12 }
          }
        }
      }
    },
    throughput: {
      code: {
        totalMs: 1200,
        writeMs: 300,
        filesPerSec: 3.33,
        chunksPerSec: 5,
        tokensPerSec: 42.5,
        bytesPerSec: 213.5,
        writeBytesPerSec: 853.3
      },
      extractedProse: {
        totalMs: 200,
        writeMs: 50,
        filesPerSec: 20,
        chunksPerSec: 0,
        tokensPerSec: 0,
        bytesPerSec: 640,
        writeBytesPerSec: 2560
      }
    }
  });

  const validation = validateArtifact('scan_profile', payload);
  assert.equal(validation.ok, true, `scan_profile invalid: ${(validation.errors || []).join('; ')}`);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.modes.code.lines.total, 42);
  assert.equal(payload.modes.code.lines.byLanguage.python, 40);
  assert.equal(payload.modes['extracted-prose'].quality.lowYieldBailout?.triggered, true);
  assert.equal(payload.totals.files.candidates, 8);
  assert.equal(payload.totals.lines, 54);
  assert.equal(payload.languageLines.markdown, 12);

  console.log('scan-profile artifact test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
