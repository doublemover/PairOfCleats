#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { getMetricsDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const testFilePath = fileURLToPath(import.meta.url);
const root = path.resolve(path.join(path.dirname(testFilePath), '..', '..', '..'));
const tempRoot = resolveTestCachePath(root, 'bench-language-stage-timing-report');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({ cache: { root: cacheRoot } }, null, 2),
  'utf8'
);
const repoUserConfig = loadUserConfig(repoRoot);
const metricsDir = getMetricsDir(repoRoot, repoUserConfig);
await fs.mkdir(metricsDir, { recursive: true });
await fs.writeFile(
  path.join(metricsDir, 'index-code.json'),
  JSON.stringify({
    timings: {
      discoverMs: 10,
      importsMs: 20,
      scmMetaMs: 5,
      writeMs: 7,
      stageTimingBreakdown: {
        schemaVersion: 1,
        parseChunk: {
          totalMs: 30,
          byLanguage: {
            javascript: { files: 1, totalMs: 30, bytes: 2048, lines: 40 }
          },
          bySizeBin: {
            '0-16kb': { files: 1, totalMs: 30, bytes: 2048, lines: 40 }
          }
        },
        inference: {
          totalMs: 12,
          byLanguage: {
            javascript: { files: 1, totalMs: 12, bytes: 2048, lines: 40 }
          },
          bySizeBin: {
            '0-16kb': { files: 1, totalMs: 12, bytes: 2048, lines: 40 }
          }
        },
        embedding: {
          totalMs: 8,
          byLanguage: {
            javascript: { files: 1, totalMs: 8, bytes: 2048, lines: 40 }
          },
          bySizeBin: {
            '0-16kb': { files: 1, totalMs: 8, bytes: 2048, lines: 40 }
          }
        },
        watchdog: {
          queueDelayMs: {
            summary: { count: 1, totalMs: 200, minMs: 200, maxMs: 200, avgMs: 200 },
            histogram: { bucketsMs: [50, 100, 250], counts: [0, 0, 1], overflow: 0 }
          }
        }
      }
    }
  }, null, 2),
  'utf8'
);

const summary = {
  backends: ['memory'],
  latencyMsAvg: { memory: 4 },
  hitRate: { memory: 1 },
  resultCountAvg: { memory: 2 },
  memoryRss: { memory: { mean: 2 * 1024 * 1024 } },
  buildMs: { index: 111, sqlite: 44 }
};

const output = await buildReportOutput({
  configPath: path.join(tempRoot, 'repos.json'),
  cacheRoot,
  resultsRoot: tempRoot,
  results: [{
    language: 'javascript',
    tier: 'tiny',
    repo: 'org/sample',
    repoPath: repoRoot,
    outFile: path.join(tempRoot, 'sample.json'),
    summary
  }],
  config: {
    javascript: { label: 'JavaScript' }
  }
});

const profile = output.tasks[0]?.stageTimingProfile;
assert.ok(profile && typeof profile === 'object', 'expected per-task stage timing profile');
const stageKeys = Object.keys(profile.stages || {}).sort();
assert.deepEqual(
  stageKeys,
  ['artifactWrite', 'discovery', 'embedding', 'importScan', 'inference', 'parseChunk', 'scmMeta', 'sqliteBuild'],
  'expected stable stage timing schema keys'
);
for (const value of Object.values(profile.stages || {})) {
  assert.equal(value >= 0, true, 'expected non-negative stage duration');
}
assert.equal(profile.stages.sqliteBuild, 44, 'expected sqlite build timing to flow from bench summary');
assert.equal(
  profile.breakdown?.parseChunk?.byLanguage?.javascript?.files >= 1,
  true,
  'expected parse/chunk language breakdown from metrics timings'
);
assert.equal(
  profile.breakdown?.parseChunk?.bySizeBin?.['0-16kb']?.files >= 1,
  true,
  'expected parse/chunk size-bin breakdown from metrics timings'
);
assert.equal(
  profile.watchdog?.queueDelayMs?.summary?.count,
  1,
  'expected queue-delay summary count to persist'
);
assert.equal(
  output.stageTiming?.schemaVersion,
  1,
  'expected top-level stage timing report schema'
);

console.log('bench language stage timing report test passed');
