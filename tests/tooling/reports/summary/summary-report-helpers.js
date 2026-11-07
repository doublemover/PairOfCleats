import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { acquireFileLock } from '../../../../src/shared/locks/file-lock.js';
import { summarizeRetrievalHitComparison } from '../../../../src/retrieval/hit-comparison.js';
import { mean, meanNullable } from '../../../../src/shared/stats.js';
import { getRepoId } from '../../../../tools/shared/dict-utils.js';

import { applyTestEnv } from '../../../helpers/test-env.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';

applyTestEnv();
const ROOT = process.cwd();
const TEMP_ROOT = resolveTestCachePath(ROOT, 'summary-report');
const CACHE_ROOT = path.join(TEMP_ROOT, 'cache');
const REPO_ROOT = path.join(TEMP_ROOT, 'repo');
const LOCK_PATH = resolveTestCachePath(ROOT, 'summary-report.lock');
const REPO_ID = getRepoId(REPO_ROOT);
const LOCK_STALE_MS = 15 * 60 * 1000;

const DEFAULT_MODEL_ID = 'Xenova/all-MiniLM-L12-v2';

const tryAcquireSummaryLock = async ({ lockPath = LOCK_PATH, staleMs = LOCK_STALE_MS } = {}) => {
  return acquireFileLock({
    lockPath,
    staleMs,
    waitMs: 0,
    timeoutBehavior: 'null',
    forceStaleCleanup: false,
    onStale: () => {
      console.warn('[summary-report] removing stale fixture lock');
    }
  });
};

export const summaryReportFixtureInternals = {
  tryAcquireSummaryLock
};

export const assertCompareModelsSummaryReport = async ({
  label,
  outFileName,
  args
}) => {
  const tempRoot = TEMP_ROOT;
  const repoRoot = REPO_ROOT;
  const outPath = path.join(tempRoot, outFileName);

  await fsPromises.mkdir(path.dirname(outPath), { recursive: true });

  const topN = 3;
  const backend = args.includes('--backend') ? args[args.indexOf('--backend') + 1] : 'memory';
  const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'both';
  const baseline = DEFAULT_MODEL_ID;
  const candidate = `${DEFAULT_MODEL_ID}-candidate`;
  const hits = {
    code: [
      { id: 'code-alpha', score: 0.99, file: 'src/index.js', startLine: 1, endLine: 4 },
      { id: 'code-beta', score: 0.72, file: 'src/util.js', startLine: 2, endLine: 8 },
      { id: 'code-gamma', score: 0.5, file: 'src/sample.py', startLine: 3, endLine: 7 }
    ],
    prose: [
      { id: 'prose-alpha', score: 0.88, file: 'README.md', startLine: 1, endLine: 3 },
      { id: 'prose-beta', score: 0.61, file: 'docs/guide.md', startLine: 4, endLine: 9 },
      { id: 'prose-gamma', score: 0.33, file: 'docs/guide.md', startLine: 11, endLine: 18 }
    ]
  };
  const candidateHits = {
    code: [hits.code[0], hits.code[2], hits.code[1]],
    prose: [hits.prose[0], hits.prose[1], hits.prose[2]]
  };
  const compareHits = (baseHits, otherHits) => {
    const { overlap, avgDelta, rankCorr, top1Same } = summarizeRetrievalHitComparison(baseHits, otherHits, { topN });
    return { overlap, avgDelta, rankCorr, top1Same };
  };
  const codeComparison = mode !== 'prose' ? compareHits(hits.code, candidateHits.code) : null;
  const proseComparison = mode !== 'code' ? compareHits(hits.prose, candidateHits.prose) : null;

  const runs = {
    [baseline]: {
      elapsedMs: 7,
      wallMs: 9,
      codeCount: mode === 'prose' ? 0 : hits.code.length,
      proseCount: mode === 'code' ? 0 : hits.prose.length
    },
    [candidate]: {
      elapsedMs: 8,
      wallMs: 10,
      codeCount: mode === 'prose' ? 0 : candidateHits.code.length,
      proseCount: mode === 'code' ? 0 : candidateHits.prose.length
    }
  };
  const payload = {
    generatedAt: '2026-05-21T00:00:00.000Z',
    repo: {
      root: path.resolve(repoRoot),
      repoId: REPO_ID
    },
    settings: {
      backend,
      topN,
      annEnabled: false,
      mode,
      models: [baseline, candidate],
      baseline,
      cacheRootBase: CACHE_ROOT,
      embeddings: {
        provider: 'stub',
        mode: 'auto',
        stub: true
      },
      cacheIsolation: true
    },
    summary: {
      models: {
        [baseline]: {
          elapsedMsAvg: runs[baseline].elapsedMs,
          wallMsAvg: runs[baseline].wallMs,
          codeCountAvg: runs[baseline].codeCount,
          proseCountAvg: runs[baseline].proseCount,
          embeddingConfig: { provider: 'stub', mode: 'auto', stub: true }
        },
        [candidate]: {
          elapsedMsAvg: runs[candidate].elapsedMs,
          wallMsAvg: runs[candidate].wallMs,
          codeCountAvg: runs[candidate].codeCount,
          proseCountAvg: runs[candidate].proseCount,
          embeddingConfig: { provider: 'stub', mode: 'auto', stub: true }
        }
      },
      comparisons: {
        [candidate]: {
          code: codeComparison,
          prose: proseComparison
        }
      }
    },
    warnings: [],
    results: [
      {
        query: 'index',
        runs,
        comparisons: {
          [candidate]: {
            code: codeComparison,
            prose: proseComparison
          }
        }
      }
    ]
  };
  await fsPromises.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');

  assert.ok(fs.existsSync(outPath), `summary report compare (${label}) should write output JSON`);

  const parsed = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.ok(parsed.summary, `summary report compare (${label}) should include summary`);
  assert.ok(Array.isArray(parsed.results), `summary report compare (${label}) should include results`);
  assert.equal(parsed.settings.backend, backend, `summary report compare (${label}) should preserve backend setting`);
  assert.equal(parsed.settings.mode, mode, `summary report compare (${label}) should preserve mode setting`);
  assert.ok(parsed.summary.models[baseline], `summary report compare (${label}) should include baseline model summary`);
  assert.ok(parsed.summary.models[candidate], `summary report compare (${label}) should include candidate model summary`);
  assert.deepEqual(parsed.results[0].comparisons[candidate].code, codeComparison);
  assert.deepEqual(parsed.results[0].comparisons[candidate].prose, proseComparison);

  return parsed;
};

const summarizeParityMatch = (memoryHits, sqliteHits, topN) => {
  const comparison = summarizeRetrievalHitComparison(memoryHits, sqliteHits, {
    topN,
    missingLimit: 5,
    treatBothEmptyAsPerfect: true
  });
  const summary = {
    overlap: comparison.overlap,
    avgDelta: comparison.avgDelta,
    missingFromSqlite: comparison.missingFromOther,
    missingFromMemory: comparison.missingFromBase,
    rankCorr: comparison.rankCorr,
    topMemory: comparison.baseKeys,
    topSqlite: comparison.otherKeys
  };
  if (comparison.zeroHits) summary.zeroHits = true;
  return summary;
};

export const assertParitySummaryReport = async ({ sqliteBackend, outFileName }) => {
  const tempRoot = TEMP_ROOT;
  const outPath = path.join(tempRoot, outFileName);
  await fsPromises.mkdir(path.dirname(outPath), { recursive: true });

  const topN = 3;
  assert.equal(summarizeParityMatch([{ id: 0 }], [{ id: 0 }], 1).overlap, 0,
    'unscoped backend ordinals cannot establish shared chunk identity');
  const rows = [
    {
      query: 'index',
      memoryHits: [
        { id: 'code-alpha', score: 0.99 },
        { id: 'code-beta', score: 0.7 },
        { id: 'code-gamma', score: 0.4 }
      ],
      sqliteHits: [
        { id: 'code-alpha', score: 0.98 },
        { id: 'code-gamma', score: 0.42 },
        { id: 'code-beta', score: 0.69 }
      ],
      proseMemoryHits: [
        { id: 'prose-alpha', score: 0.9 },
        { id: 'prose-beta', score: 0.6 }
      ],
      proseSqliteHits: [
        { id: 'prose-alpha', score: 0.89 },
        { id: 'prose-beta', score: 0.62 }
      ]
    },
    {
      query: 'sqlite',
      memoryHits: [
        { id: 'code-delta', score: 0.8 },
        { id: 'code-epsilon', score: 0.52 }
      ],
      sqliteHits: [
        { id: 'code-delta', score: 0.79 },
        { id: 'code-zeta', score: 0.5 }
      ],
      proseMemoryHits: [],
      proseSqliteHits: []
    }
  ];
  // These symbolic fixture ids represent stable authored chunks, not backend
  // ordinals. Give both representations the actual cross-backend identity.
  for (const row of rows) {
    for (const hits of [row.memoryHits, row.sqliteHits, row.proseMemoryHits, row.proseSqliteHits]) {
      for (const hit of hits) hit.chunkUid = `summary-fixture:${hit.id}`;
    }
  }
  const results = rows.map((row, index) => ({
    query: row.query,
    memory: {
      stats: { elapsedMs: 3 + index, memory: { rss: (20 + index) * 1024 * 1024 } },
      wallMs: 5 + index
    },
    sqlite: {
      stats: { elapsedMs: 4 + index, memory: { rss: (18 + index) * 1024 * 1024 } },
      wallMs: 6 + index
    },
    code: summarizeParityMatch(row.memoryHits, row.sqliteHits, topN),
    prose: summarizeParityMatch(row.proseMemoryHits, row.proseSqliteHits, topN)
  }));
  const overlapValues = results.flatMap((entry) => [entry.code.overlap, entry.prose.overlap]);
  const deltaValues = results.flatMap((entry) => [entry.code.avgDelta, entry.prose.avgDelta]);
  const rankCorrValues = results.flatMap((entry) => [entry.code.rankCorr, entry.prose.rankCorr]);
  const summary = {
    queries: results.length,
    topN,
    annEnabled: false,
    sqliteBackend,
    overlapAvg: mean(overlapValues),
    scoreDeltaAvg: meanNullable(deltaValues),
    rankCorrAvg: meanNullable(rankCorrValues),
    latencyMsAvg: {
      memory: mean(results.map((entry) => entry.memory.stats.elapsedMs)),
      sqlite: mean(results.map((entry) => entry.sqlite.stats.elapsedMs))
    },
    wallMsAvg: {
      memory: mean(results.map((entry) => entry.memory.wallMs)),
      sqlite: mean(results.map((entry) => entry.sqlite.wallMs))
    },
    rssMbAvg: {
      memory: mean(results.map((entry) => entry.memory.stats.memory.rss / (1024 * 1024))),
      sqlite: mean(results.map((entry) => entry.sqlite.stats.memory.rss / (1024 * 1024)))
    }
  };
  const payload = {
    generatedAt: '2026-05-21T00:00:00.000Z',
    queryFile: path.join(ROOT, 'tests', 'retrieval', 'parity', 'parity-queries.txt'),
    topN,
    annEnabled: false,
    summary,
    results
  };

  await fsPromises.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');
  assert.ok(fs.existsSync(outPath), `summary report parity (${sqliteBackend}) should write output JSON`);

  const parsed = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.ok(parsed.summary, `summary report parity (${sqliteBackend}) should include summary`);
  assert.ok(Array.isArray(parsed.results), `summary report parity (${sqliteBackend}) should include results`);
  assert.equal(parsed.summary.sqliteBackend, sqliteBackend, `summary report parity (${sqliteBackend}) should preserve backend`);
  assert.equal(parsed.summary.queries, results.length, `summary report parity (${sqliteBackend}) should preserve query count`);
  assert.equal(parsed.results[0].code.overlap, 1, `summary report parity (${sqliteBackend}) should compare code hits`);
  assert.equal(parsed.results[1].prose.zeroHits, true, `summary report parity (${sqliteBackend}) should preserve zero-hit semantics`);
  assert.equal(parsed.summary.overlapAvg, mean(overlapValues));

  return parsed;
};
