#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-language-reuse-summary-prefers-scan-profile');
const logsRoot = path.join(tempRoot, 'logs', 'bench-language');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(logsRoot, { recursive: true });

const outFile = path.join(tempRoot, 'task.json');
await fsPromises.writeFile(outFile, JSON.stringify({
  artifacts: {
    scanProfile: {
      schemaVersion: 1,
      generatedAt: '2026-03-23T00:00:00.000Z',
      source: 'report-artifacts',
      repo: { root: 'C:/repo', cacheRoot: 'C:/cache' },
      modes: {
        code: { reuse: null },
        prose: { reuse: null },
        'extracted-prose': { reuse: null },
        records: { reuse: null }
      },
      totals: {
        files: { candidates: 0, scanned: 0, skipped: 0 },
        chunks: 0,
        tokens: 0,
        lines: null,
        bytes: { source: null, artifact: 0 },
        durationMs: null,
        filesPerSec: null,
        chunksPerSec: null,
        tokensPerSec: null,
        bytesPerSec: null,
        linesPerSec: null
      },
      languageLines: {},
      reuse: {
        observationCount: 2,
        generationAware: true,
        generation: {
          mode: 'code',
          repoRoot: 'C:/repo',
          buildRoot: 'C:/cache/builds/run-1/index-code',
          buildId: 'run-1'
        },
        countsByCause: { cache_miss: 1, cache_invalid: 1 },
        countsBySurface: { 'provider-result': 2 },
        countsBySurfaceAndSource: { 'provider-result:live': 2 },
        countsByQualityImpact: { none: 2 },
        scmSnapshotSources: {},
        providerResultSources: { live: 2 },
        cost: {
          timeCostMs: 180,
          requestedCount: 0,
          reusedCount: 0,
          fetchedCount: 0,
          chunkCount: 4
        },
        observations: [
          {
            kind: 'provider_cache',
            providerId: 'pyright',
            reuseSurface: 'provider-result',
            reuseSource: 'live',
            causeClass: 'cache_invalid',
            qualityImpact: 'none',
            requestedCount: null,
            reusedCount: null,
            fetchedCount: null,
            chunkCount: null,
            timeCostMs: null,
            generation: {
              mode: 'code',
              repoRoot: 'C:/repo',
              buildRoot: 'C:/cache/builds/run-1/index-code',
              buildId: 'run-1'
            }
          },
          {
            kind: 'provider_result',
            providerId: 'pyright',
            reuseSurface: 'provider-result',
            reuseSource: 'live',
            causeClass: 'cache_miss',
            qualityImpact: 'none',
            requestedCount: null,
            reusedCount: null,
            fetchedCount: null,
            chunkCount: 4,
            timeCostMs: 180,
            generation: {
              mode: 'code',
              repoRoot: 'C:/repo',
              buildRoot: 'C:/cache/builds/run-1/index-code',
              buildId: 'run-1'
            }
          }
        ]
      }
    }
  }
}, null, 2), 'utf8');

await fsPromises.writeFile(
  path.join(logsRoot, 'run-ub060-all.log'),
  '[scm] file-meta snapshot: source=cache requested=10 reused=10 fetched=0. elapsedMs=12\n',
  'utf8'
);

const output = await buildReportOutput({
  configPath: '/tmp/repos.json',
  cacheRoot: '/tmp/cache',
  resultsRoot: tempRoot,
  results: [{
    language: 'javascript',
    repo: 'sample',
    tier: 'small',
    outFile
  }],
  config: {}
});

const reuse = output?.diagnostics?.reuse;
assert.ok(reuse && typeof reuse === 'object', 'expected reuse diagnostics summary');
assert.equal(reuse.observationCount, 2, 'expected artifact-backed reuse summary to win over log fallback');
assert.equal(reuse.countsByCause.cache_invalid, 1);
assert.equal(reuse.countsByCause.cache_miss, 1);
assert.equal(reuse.countsBySurface['provider-result'], 2);
assert.equal(reuse.cost.timeCostMs, 180);
assert.equal(reuse.generationAware, true);

await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('bench language reuse summary prefers scan profile test passed');
