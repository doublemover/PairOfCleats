#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createCli } from '../../../src/shared/cli.js';
import { getIndexDir, loadUserConfig, resolveSqlitePaths } from '../../../tools/dict-utils.js';

const argv = createCli({
  scriptName: 'parity',
  options: {
    ann: { type: 'boolean', default: true },
    'write-report': { type: 'boolean', default: false },
    enforce: { type: 'boolean', default: false },
    'enforce-fts': { type: 'boolean', default: false },
    'min-overlap': { type: 'number' },
    'min-rank-corr': { type: 'number' },
    'max-delta': { type: 'number' },
    'min-overlap-single': { type: 'number' },
    queries: { type: 'string' },
    out: { type: 'string' },
    search: { type: 'string' },
    'sqlite-backend': { type: 'string', default: 'sqlite' },
    top: { type: 'number', default: 5 },
    limit: { type: 'number', default: 0 }
  },
  aliases: { n: 'top', q: 'queries' }
}).parse();

const root = process.cwd();
const repoArgs = ['--repo', root];
const userConfig = loadUserConfig(root);
const isTestRun = process.env.PAIROFCLEATS_TESTING === '1';
const resolveSqlitePathsForRoot = () => resolveSqlitePaths(root, userConfig);

const searchPath = argv.search
  ? path.resolve(argv.search)
  : path.join(root, 'search.js');
if (!fsSync.existsSync(searchPath)) {
  console.error(`search.js not found at ${searchPath}`);
  process.exit(1);
}

function resolveIndexDir(mode) {
  const cached = getIndexDir(root, mode, userConfig);
  const hasMeta = (dir) => (
    fsSync.existsSync(path.join(dir, 'chunk_meta.json'))
    || fsSync.existsSync(path.join(dir, 'chunk_meta.jsonl'))
    || fsSync.existsSync(path.join(dir, 'chunk_meta.meta.json'))
  );
  if (hasMeta(cached)) return cached;
  const local = path.join(root, `index-${mode}`);
  if (hasMeta(local)) return local;
  return cached;
}

function resolveChunkMetaPath(dir) {
  const candidates = ['chunk_meta.json', 'chunk_meta.jsonl', 'chunk_meta.meta.json'];
  for (const name of candidates) {
    const candidate = path.join(dir, name);
    if (fsSync.existsSync(candidate)) return candidate;
  }
  return path.join(dir, 'chunk_meta.json');
}

function requireIndex(mode) {
  const dir = resolveIndexDir(mode);
  const metaPath = resolveChunkMetaPath(dir);
  if (!fsSync.existsSync(metaPath)) {
    console.error(`Missing ${metaPath}. Build the index first.`);
    process.exit(1);
  }
}

function ensureParityIndexes() {
  if (!isTestRun) return;
  const missingIndex = ['code', 'prose'].some((mode) => {
    const dir = resolveIndexDir(mode);
    const metaPath = resolveChunkMetaPath(dir);
    return !fsSync.existsSync(metaPath);
  });
  const sqlitePaths = resolveSqlitePathsForRoot();
  const missingSqlite = !fsSync.existsSync(sqlitePaths.codePath) || !fsSync.existsSync(sqlitePaths.prosePath);
  if (!missingIndex && !missingSqlite) return;

  const env = { ...process.env };
  if (!env.PAIROFCLEATS_EMBEDDINGS) {
    env.PAIROFCLEATS_EMBEDDINGS = 'stub';
  }

  const buildResult = spawnSync(
    process.execPath,
    [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', root],
    { env, cwd: root, stdio: 'inherit' }
  );
  if (buildResult.status !== 0) {
    console.error('Parity test failed: build index');
    process.exit(buildResult.status ?? 1);
  }

  const sqliteResult = spawnSync(
    process.execPath,
    [path.join(root, 'tools', 'build-sqlite-index.js'), '--repo', root],
    { env, cwd: root, stdio: 'inherit' }
  );
  if (sqliteResult.status !== 0) {
    console.error('Parity test failed: build sqlite index');
    process.exit(sqliteResult.status ?? 1);
  }
}

ensureParityIndexes();
const sqlitePaths = resolveSqlitePathsForRoot();

requireIndex('code');
requireIndex('prose');

const missing = [];
if (!fsSync.existsSync(sqlitePaths.codePath)) missing.push(`code=${sqlitePaths.codePath}`);
if (!fsSync.existsSync(sqlitePaths.prosePath)) missing.push(`prose=${sqlitePaths.prosePath}`);
if (missing.length) {
  console.error(`SQLite index not found (${missing.join(', ')}). Build the sqlite index first.`);
  process.exit(1);
}

const defaultQueriesPath = path.join(root, 'tests', 'parity-queries.txt');
const queriesPath = argv.queries ? path.resolve(argv.queries) : defaultQueriesPath;
if (argv.queries && !fsSync.existsSync(queriesPath)) {
  console.error(`Query file not found at ${queriesPath}`);
  process.exit(1);
}
const fallbackQueries = [
  'index',
  'search',
  'sqlite',
  'dictionary',
  'bootstrap',
  'chunk',
  'minhash',
  'ann',
  'bm25',
  'cache'
];

async function loadQueries(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (filePath.endsWith('.json')) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
      if (Array.isArray(parsed.queries)) return parsed.queries.map(String).filter(Boolean);
      return [];
    }
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

const loadedQueries = await loadQueries(queriesPath);
const queries = loadedQueries.length ? loadedQueries : fallbackQueries;
if (!loadedQueries.length) {
  console.warn(`Query file not found or empty; using fallback queries (${queries.length}).`);
}

const topN = Math.max(1, parseInt(argv.top, 10) || 5);
const limit = Math.max(0, parseInt(argv.limit, 10) || 0);
const selectedQueries = limit > 0 ? queries.slice(0, limit) : queries;
const annEnabled = argv.ann !== false;
const annArg = annEnabled ? '--ann' : '--no-ann';
const sqliteBackendRaw = String(argv['sqlite-backend'] || 'sqlite').toLowerCase();
if (!['sqlite', 'sqlite-fts', 'fts'].includes(sqliteBackendRaw)) {
  console.error('Invalid sqlite backend. Use --sqlite-backend sqlite|sqlite-fts.');
  process.exit(1);
}
const sqliteBackend = sqliteBackendRaw === 'fts' ? 'sqlite-fts' : sqliteBackendRaw;

const formatDuration = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs - (mins * 60);
  return `${mins}m${rem.toFixed(0)}s`;
};

function runSearch(query, backend) {
  const args = [
    searchPath,
    query,
    '--json',
    '--stats',
    '--compact',
    '--backend',
    backend,
    '-n',
    String(topN),
    annArg,
    ...repoArgs
  ];
  const start = performance.now();
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024
  });
  const wallMs = performance.now() - start;
  if (result.status !== 0) {
    console.error(`Search failed for backend=${backend} query="${query}"`);
    if (result.error?.message) console.error(result.error.message.trim());
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status || 1);
  }
  const payload = JSON.parse(result.stdout);
  return { payload, wallMs };
}

function hitKey(hit, index) {
  if (hit && (hit.id || hit.id === 0)) return String(hit.id);
  if (hit && hit.file) {
    const start = hit.startLine ?? hit.start ?? 0;
    const end = hit.endLine ?? hit.end ?? 0;
    return `${hit.file}:${start}:${end}:${hit.kind || ''}:${hit.name || ''}`;
  }
  return String(index);
}

function hitScore(hit) {
  if (!hit || typeof hit !== 'object') return 0;
  if (Number.isFinite(hit.score)) return hit.score;
  const selected = hit.scoreBreakdown?.selected?.score;
  if (Number.isFinite(selected)) return selected;
  if (Number.isFinite(hit.sparseScore)) return hit.sparseScore;
  if (Number.isFinite(hit.annScore)) return hit.annScore;
  return 0;
}

function summarizeMatch(memoryHits, sqliteHits) {
  const mem = memoryHits.slice(0, topN);
  const sql = sqliteHits.slice(0, topN);
  if (!mem.length && !sql.length) {
    return {
      overlap: 1,
      avgDelta: 0,
      missingFromSqlite: [],
      missingFromMemory: [],
      rankCorr: null,
      topMemory: [],
      topSqlite: [],
      zeroHits: true
    };
  }
  const memKeys = mem.map(hitKey);
  const sqlKeys = sql.map(hitKey);
  const memRanks = new Map(memKeys.map((key, idx) => [key, idx + 1]));
  const sqlRanks = new Map(sqlKeys.map((key, idx) => [key, idx + 1]));
  const memSet = new Set(memKeys);
  const sqlSet = new Set(sqlKeys);
  const intersection = memKeys.filter((key) => sqlSet.has(key));
  const overlap = intersection.length / Math.max(1, Math.min(memKeys.length, sqlKeys.length));

  const memScores = new Map(mem.map((hit, idx) => [hitKey(hit, idx), hitScore(hit)]));
  const sqlScores = new Map(sql.map((hit, idx) => [hitKey(hit, idx), hitScore(hit)]));
  const deltas = intersection.map((key) => Math.abs((memScores.get(key) || 0) - (sqlScores.get(key) || 0)));
  const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;

  const missingFromSqlite = memKeys.filter((key) => !sqlSet.has(key));
  const missingFromMemory = sqlKeys.filter((key) => !memSet.has(key));

  let rankCorr = null;
  if (intersection.length >= 2) {
    let sum = 0;
    for (const key of intersection) {
      const d = (memRanks.get(key) || 0) - (sqlRanks.get(key) || 0);
      sum += d * d;
    }
    const n = intersection.length;
    rankCorr = 1 - (6 * sum) / (n * (n * n - 1));
  }

  return {
    overlap,
    avgDelta,
    missingFromSqlite: missingFromSqlite.slice(0, 5),
    missingFromMemory: missingFromMemory.slice(0, 5),
    rankCorr,
    topMemory: memKeys,
    topSqlite: sqlKeys
  };
}

function mean(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function meanNullable(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function toMb(bytes) {
  return bytes ? bytes / (1024 * 1024) : 0;
}

const results = [];
const totalQueries = selectedQueries.length;
const overallStart = performance.now();
let completed = 0;
for (const query of selectedQueries) {
  const queryStart = performance.now();
  const memRun = runSearch(query, 'memory');
  const sqlRun = runSearch(query, sqliteBackend);
  const memPayload = memRun.payload;
  const sqlPayload = sqlRun.payload;

  results.push({
    query,
    memory: {
      stats: memPayload.stats || {},
      wallMs: memRun.wallMs
    },
    sqlite: {
      stats: sqlPayload.stats || {},
      wallMs: sqlRun.wallMs
    },
    code: summarizeMatch(memPayload.code || [], sqlPayload.code || []),
    prose: summarizeMatch(memPayload.prose || [], sqlPayload.prose || [])
  });

  completed += 1;
  const elapsed = performance.now() - overallStart;
  const avg = elapsed / completed;
  const remaining = avg * Math.max(0, totalQueries - completed);
  const queryElapsed = performance.now() - queryStart;
  console.log(
    `[parity] ${completed}/${totalQueries} (${Math.round((completed / totalQueries) * 100)}%) ` +
    `query="${query}" last=${formatDuration(queryElapsed)} ` +
    `mem=${formatDuration(memRun.wallMs)} sqlite=${formatDuration(sqlRun.wallMs)} ` +
    `elapsed=${formatDuration(elapsed)} eta=${formatDuration(remaining)}`
  );
}

const overlapValues = results.flatMap((entry) => [entry.code.overlap, entry.prose.overlap]);
const deltaValues = results.flatMap((entry) => [entry.code.avgDelta, entry.prose.avgDelta]);
const rankCorrValues = results.flatMap((entry) => [entry.code.rankCorr, entry.prose.rankCorr]);
const memLatency = results.map((entry) => entry.memory.stats.elapsedMs || 0);
const sqlLatency = results.map((entry) => entry.sqlite.stats.elapsedMs || 0);
const memWall = results.map((entry) => entry.memory.wallMs || 0);
const sqlWall = results.map((entry) => entry.sqlite.wallMs || 0);

const memRss = results.map((entry) => toMb(entry.memory.stats.memory?.rss || 0));
const sqlRss = results.map((entry) => toMb(entry.sqlite.stats.memory?.rss || 0));

const summary = {
  queries: results.length,
  topN,
  annEnabled,
  sqliteBackend,
  overlapAvg: mean(overlapValues),
  scoreDeltaAvg: mean(deltaValues),
  rankCorrAvg: meanNullable(rankCorrValues),
  latencyMsAvg: {
    memory: mean(memLatency),
    sqlite: mean(sqlLatency)
  },
  wallMsAvg: {
    memory: mean(memWall),
    sqlite: mean(sqlWall)
  },
  rssMbAvg: {
    memory: mean(memRss),
    sqlite: mean(sqlRss)
  }
};

console.log('Parity summary');
console.log(`- Queries: ${summary.queries}`);
console.log(`- TopN: ${summary.topN}`);
console.log(`- Ann: ${summary.annEnabled}`);
console.log(`- SQLite backend: ${summary.sqliteBackend}`);
console.log(`- Overlap avg: ${summary.overlapAvg.toFixed(3)}`);
console.log(`- Score delta avg: ${summary.scoreDeltaAvg.toFixed(4)}`);
if (summary.rankCorrAvg === null) {
  console.log('- Rank corr avg: n/a');
} else {
  console.log(`- Rank corr avg: ${summary.rankCorrAvg.toFixed(3)}`);
}
console.log(`- Latency ms avg (memory/sqlite): ${summary.latencyMsAvg.memory.toFixed(1)} / ${summary.latencyMsAvg.sqlite.toFixed(1)}`);
console.log(`- Wall ms avg (memory/sqlite): ${summary.wallMsAvg.memory.toFixed(1)} / ${summary.wallMsAvg.sqlite.toFixed(1)}`);
console.log(`- RSS MB avg (memory/sqlite): ${summary.rssMbAvg.memory.toFixed(1)} / ${summary.rssMbAvg.sqlite.toFixed(1)}`);

const report = {
  generatedAt: new Date().toISOString(),
  queryFile: queriesPath,
  topN,
  annEnabled,
  summary,
  results
};

if (argv['write-report']) {
  const outPath = argv.out
    ? path.resolve(argv.out)
    : path.join(root, 'docs', 'phase3-parity-report.json');
  await fs.writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(`Report written to ${outPath}`);
}

if (argv.enforce) {
  const isFts = sqliteBackend === 'sqlite-fts';
  const defaults = isFts
    ? { minOverlap: 0.7, minRankCorr: 0.55, maxDelta: 0.5, minSingleOverlap: 0.6 }
    : { minOverlap: 0.95, minRankCorr: 0.9, maxDelta: 0.1, minSingleOverlap: 0.6 };
  const thresholds = {
    minOverlap: Number.isFinite(argv['min-overlap']) ? argv['min-overlap'] : defaults.minOverlap,
    minRankCorr: Number.isFinite(argv['min-rank-corr']) ? argv['min-rank-corr'] : defaults.minRankCorr,
    maxDelta: Number.isFinite(argv['max-delta']) ? argv['max-delta'] : defaults.maxDelta,
    minSingleOverlap: Number.isFinite(argv['min-overlap-single'])
      ? argv['min-overlap-single']
      : defaults.minSingleOverlap
  };
  const minOverlapSingle = overlapValues.length ? Math.min(...overlapValues) : 1;
  const failures = [];
  if (summary.overlapAvg < thresholds.minOverlap) {
    failures.push(`overlapAvg ${summary.overlapAvg.toFixed(3)} < ${thresholds.minOverlap}`);
  }
  if (summary.rankCorrAvg !== null && summary.rankCorrAvg < thresholds.minRankCorr) {
    failures.push(`rankCorrAvg ${summary.rankCorrAvg.toFixed(3)} < ${thresholds.minRankCorr}`);
  }
  if (summary.scoreDeltaAvg > thresholds.maxDelta) {
    failures.push(`avgDelta ${summary.scoreDeltaAvg.toFixed(3)} > ${thresholds.maxDelta}`);
  }
  if (minOverlapSingle < thresholds.minSingleOverlap) {
    failures.push(`minOverlap@K ${minOverlapSingle.toFixed(3)} < ${thresholds.minSingleOverlap}`);
  }
  if (failures.length) {
    const label = failures.join('; ');
    if (isFts && argv['enforce-fts'] !== true) {
      console.warn(`SQLite FTS parity warning: ${label}`);
    } else {
      console.error(`Parity thresholds failed: ${label}`);
      process.exit(1);
    }
  }
}
