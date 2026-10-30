#!/usr/bin/env node
import assert from 'node:assert/strict';
import { BENCH_REMEDIATION_VERSION } from '../../../src/contracts/benchmark-remediation.js';
import path from 'node:path';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const now = new Date().toISOString();
const output = await buildReportOutput({
  configPath: path.join(process.cwd(), 'benchmarks', 'repos.json'),
  cacheRoot: resolveTestCachePath(process.cwd(), 'bench-lang-remediation-cache'),
  resultsRoot: resolveTestCachePath(process.cwd(), 'bench-lang-remediation-results'),
  results: [
    {
      language: 'lua',
      tier: 'typical',
      repo: 'lunarmodules/luasocket',
      repoPath: null,
      outFile: resolveTestCachePath(process.cwd(), 'bench-lang-remediation-results', 'lua', 'luasocket.json'),
      summary: {
        generatedAt: now,
        backends: ['memory', 'sqlite'],
        hitRate: { memory: 0.42, sqlite: 0.38 },
        resultCountAvg: { memory: 0.6, sqlite: 0.5 },
        queryWallMsPerSearch: 355,
        queryWallMsPerQuery: 712,
        latencyMsAvg: { memory: 120, sqlite: 140 },
        missTaxonomy: {
          byBackend: {
            memory: { lexical_language_segmentation: 4, rank_symbol_heavy_query: 2 },
            sqlite: { lexical_language_segmentation: 3 }
          },
          lowHitByBackend: {
            memory: { lexical_language_segmentation: 3 },
            sqlite: { lexical_language_segmentation: 2 }
          }
        }
      }
    },
    {
      language: 'go',
      tier: 'small',
      repo: 'golang/example',
      repoPath: null,
      outFile: resolveTestCachePath(process.cwd(), 'bench-lang-remediation-results', 'go', 'example.json'),
      summary: {
        generatedAt: now,
        backends: ['memory', 'sqlite'],
        hitRateMemory: 0.4,
        hitRateSqlite: 0.45,
        resultCountMemory: 0.7,
        resultCountSqlite: 0.8,
        queryWallMsPerSearch: 250,
        queryWallMsPerQuery: 500,
        latencyMsAvg: { memory: 98, sqlite: 121 }
      }
    },
    {
      language: 'javascript',
      tier: 'typical',
      repo: 'expressjs/express',
      repoPath: null,
      outFile: resolveTestCachePath(process.cwd(), 'bench-lang-remediation-results', 'javascript', 'express.json'),
      summary: {
        generatedAt: now,
        backends: ['memory', 'sqlite'],
        hitRate: { memory: 0.94, sqlite: 0.91 },
        resultCountAvg: { memory: 4.2, sqlite: 3.8 },
        queryWallMsPerSearch: 85,
        queryWallMsPerQuery: 170,
        latencyMsAvg: { memory: 32, sqlite: 35 }
      }
    }
  ],
  config: {
    lua: { label: 'Lua' },
    javascript: { label: 'JavaScript' }
  }
});

assert.ok(output.remediation && typeof output.remediation === 'object', 'missing remediation report');
assert.equal(output.remediation.schemaVersion, BENCH_REMEDIATION_VERSION, 'unexpected remediation schema version');
assert.equal(output.remediation.reposConsidered, 3, 'expected three repos considered');
assert.equal(output.remediation.lowHitCount, 2, 'expected two low-hit repos');

const lowHit = output.remediation.lowHitRepos.find((entry) => entry.language === 'lua');
assert.ok(lowHit, 'expected lua repo in low-hit remediation rows');
assert.equal(lowHit.language, 'lua', 'expected low-hit language to be lua');
assert.equal(lowHit.repo, 'lunarmodules/luasocket', 'expected low-hit repo to match fixture');
assert.equal(lowHit.bestHitRate < output.remediation.lowHitThreshold, true, 'expected low-hit repo below threshold');
assert.equal(
  Array.isArray(lowHit.rankedSuggestions) && lowHit.rankedSuggestions.length >= 3,
  true,
  'expected ranked remediation suggestions'
);
assert.equal(
  Array.isArray(lowHit.missTaxonomyTop) && lowHit.missTaxonomyTop[0]?.label === 'lexical_language_segmentation',
  true,
  'expected remediation row to include top miss-taxonomy labels'
);

const suggestionIds = lowHit.rankedSuggestions.map((entry) => entry.suggestionId);
assert.equal(
  suggestionIds.includes('workload.validate-expectations'),
  true,
  'expected workload diagnostic for low-nonempty repo'
);
assert.equal(
  suggestionIds.includes('retrieval.inspect-source-coverage'),
  true,
  'expected source coverage hypothesis for low-nonempty repo'
);
assert.equal(
  suggestionIds.includes('query.inspect-parsing'),
  true,
  'expected query interpretation hypothesis for low-nonempty repo'
);
for (let index = 1; index < lowHit.rankedSuggestions.length; index += 1) {
  const prior = Number(lowHit.rankedSuggestions[index - 1].score) || 0;
  const current = Number(lowHit.rankedSuggestions[index].score) || 0;
  assert.equal(prior >= current, true, 'expected ranked suggestions sorted by score');
}

assert.equal(
  Array.isArray(output.remediation.topSuggestions) && output.remediation.topSuggestions.length > 0,
  true,
  'expected aggregated top suggestions'
);
assert.equal(
  output.remediation.topSuggestions[0].suggestionId,
  lowHit.rankedSuggestions[0].suggestionId,
  'expected top suggestion aggregation to align with per-repo ranking'
);
assert.equal(
  output.remediation.loop.trackedSuggestions >= lowHit.rankedSuggestions.length,
  true,
  'expected remediation loop to track generated suggestions'
);

assert.equal(lowHit.metric, 'nonempty-result-frequency');
assert.equal(lowHit.missTaxonomyTop[0].total, 7);
assert.equal(lowHit.missTaxonomyTop[0].zeroHit, 5);
assert.ok(lowHit.rankedSuggestions.every(row => row.kind === 'diagnostic-hypothesis' && !row.loop.accepted));
console.log('bench language low-hit remediation report test passed');
