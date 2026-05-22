#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadOrComputeIndexingSummary } from '../../../tools/reports/show-throughput/analysis.js';
import { emptyScanProfileMode, runShowThroughputFixture } from './show-throughput-scan-test-helpers.js';

const payload = {
  repo: {
    root: 'C:/repo'
  },
  summary: {
    buildMs: { index: 10, sqlite: 5 },
    queryWallMsPerQuery: 2,
    queryWallMsPerSearch: 3,
    latencyMs: {
      memory: { mean: 1, p95: 2 },
      sqlite: { mean: 2, p95: 3 }
    }
  },
  artifacts: {
    repo: {
      root: 'C:/repo',
      cacheRoot: 'C:/cache'
    },
    throughput: {
      code: {
        files: 1,
        chunks: 1,
        tokens: 10,
        bytes: 128,
        totalMs: 1000,
        filesPerSec: 1,
        chunksPerSec: 1,
        tokensPerSec: 10,
        bytesPerSec: 128
      }
    },
    scanProfile: {
      schemaVersion: 1,
      generatedAt: '2026-03-21T00:00:00.000Z',
      source: 'report-artifacts',
      repo: {
        root: 'C:/repo',
        cacheRoot: 'C:/cache'
      },
      modes: {
        code: {
          mode: 'code',
          indexDir: 'C:/cache/index-code',
          cache: { hits: 1, misses: 0, hitRate: 1 },
          files: { candidates: 2, scanned: 2, skipped: 0, skippedByReason: {} },
          chunks: { total: 2, avgTokens: 10 },
          tokens: { total: 20, vocab: 8 },
          lines: {
            total: 87,
            byLanguage: {
              '{.python}': 15,
              '{.xml}': 1,
              '{.haskell}': 63,
              hs: 6,
              unknown: 2
            }
          },
          bytes: { source: 512, artifact: 256 },
          artifacts: { filterIndex: null },
          timings: { totalMs: 1000, writeMs: 200 },
          throughput: {
            totalMs: 1000,
            writeMs: 200,
            filesPerSec: 2,
            chunksPerSec: 2,
            tokensPerSec: 20,
            bytesPerSec: 256,
            linesPerSec: 87,
            writeBytesPerSec: 1280
          },
          queues: { postings: null },
          quality: { lowYieldBailout: null }
        },
        prose: emptyScanProfileMode('prose'),
        'extracted-prose': emptyScanProfileMode('extracted-prose'),
        records: emptyScanProfileMode('records')
      },
      totals: {
        files: { candidates: 2, scanned: 2, skipped: 0 },
        chunks: 2,
        tokens: 20,
        lines: 87,
        bytes: { source: 512, artifact: 256 },
        durationMs: 1000,
        filesPerSec: 2,
        chunksPerSec: 2,
        tokensPerSec: 20,
        bytesPerSec: 256,
        linesPerSec: 87
      },
      languageLines: {
        '{.python}': 15,
        '{.xml}': 1,
        '{.haskell}': 63,
        hs: 6,
        unknown: 2
      }
    }
  }
};

const indexingSummary = loadOrComputeIndexingSummary({
  payload: structuredClone(payload),
  featureMetrics: {
    modes: {
      code: {
        totals: { count: 1, lines: 999, bytes: 999, durationMs: 1000 }
      }
    }
  },
  refreshJson: false
}).indexingSummary;

assert.equal(indexingSummary?.source, 'scan-profile');
assert.equal(indexingSummary?.modes?.code?.lines, 87);

const { output } = await runShowThroughputFixture({
  payload,
  tempPrefix: 'poc-show-throughput-scan-profile-'
});
assert.equal(output.includes('87 lines  2 files'), true, 'expected scanProfile lines to drive indexed totals');
assert.equal(output.includes('python       15'), true, 'expected scanProfile language lines to be normalized and rendered');
assert.equal(output.includes('haskell      69'), true, 'expected scanProfile language aliases to collapse');
assert.equal(
  output.includes('native-scan-profile 1'),
  true,
  'expected report provenance to surface scan-profile-derived indexing'
);

console.log('show-throughput scan-profile preferred test passed');
