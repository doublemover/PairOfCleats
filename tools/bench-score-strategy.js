#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { execaSync } from 'execa';
import { getIndexDir, loadUserConfig, resolveToolRoot } from './dict-utils.js';

const argv = createCli({
  scriptName: 'bench-score-strategy',
  options: {
    build: { type: 'boolean', default: false },
    'build-index': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    'stub-embeddings': { type: 'boolean', default: false },
    'in-place': { type: 'boolean', default: false },
    repo: { type: 'string' },
    queries: { type: 'string' },
    out: { type: 'string' },
    backend: { type: 'string' },
    top: { type: 'number' },
    limit: { type: 'number' }
  }
}).parse();

const toolRoot = resolveToolRoot();
const root = process.cwd();
const repoSource = path.resolve(
  argv.repo || path.join(root, 'tests', 'fixtures', 'sample')
);
const useInPlace = argv['in-place'] === true;
const tempRoot = path.join(root, 'tests', '.cache', 'bench-score-strategy');
const workRoot = useInPlace ? repoSource : path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const queriesPath = path.resolve(
  argv.queries || path.join(repoSource, 'queries.txt')
);
const backend = argv.backend ? String(argv.backend) : 'memory';
const topN = Number.isFinite(Number(argv.top)) ? Math.max(1, Number(argv.top)) : 5;
const limit = Number.isFinite(Number(argv.limit)) ? Math.max(0, Number(argv.limit)) : 0;
const buildRequested = argv.build === true || argv['build-index'] === true;
const useStubEmbeddings = argv['stub-embeddings'] === true;

function runCommand(label, args, env) {
  const result = execaSync(process.execPath, args, { encoding: 'utf8', env, reject: false });
  if (result.exitCode !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.exitCode ?? 1);
  }
  return result.stdout || '';
}

async function loadQueries(filePath) {
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

async function ensureWorkRoot() {
  if (useInPlace) return;
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
  await fsPromises.mkdir(workRoot, { recursive: true });
  await fsPromises.cp(repoSource, workRoot, { recursive: true });
}

function hasIndexArtifacts(repoRoot, userConfig) {
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  const proseDir = getIndexDir(repoRoot, 'prose', userConfig);
  const codeMeta = path.join(codeDir, 'chunk_meta.json');
  const proseMeta = path.join(proseDir, 'chunk_meta.json');
  return fs.existsSync(codeMeta) && fs.existsSync(proseMeta);
}

async function writeBlendConfig(repoRoot, baseConfig, enabled) {
  const next = { ...(baseConfig || {}) };
  const search = { ...(next.search || {}) };
  const existingBlend = search.scoreBlend || {};
  search.scoreBlend = {
    ...existingBlend,
    enabled,
    sparseWeight: Number.isFinite(Number(existingBlend.sparseWeight))
      ? Number(existingBlend.sparseWeight)
      : 1,
    annWeight: Number.isFinite(Number(existingBlend.annWeight))
      ? Number(existingBlend.annWeight)
      : 1
  };
  next.search = search;
  const configPath = path.join(repoRoot, '.pairofcleats.json');
  await fsPromises.writeFile(configPath, JSON.stringify(next, null, 2));
  return configPath;
}

async function restoreConfig(repoRoot, originalConfig, configExisted) {
  const configPath = path.join(repoRoot, '.pairofcleats.json');
  if (configExisted) {
    await fsPromises.writeFile(configPath, originalConfig);
  } else if (fs.existsSync(configPath)) {
    await fsPromises.rm(configPath, { force: true });
  }
}

await ensureWorkRoot();
await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
if (useStubEmbeddings) process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const envBase = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot
};
if (useStubEmbeddings) envBase.PAIROFCLEATS_EMBEDDINGS = 'stub';

const queries = await loadQueries(queriesPath);
if (!queries.length) {
  console.error(`No queries found at ${queriesPath}`);
  process.exit(1);
}
const selectedQueries = limit > 0 ? queries.slice(0, limit) : queries;

const configPath = path.join(workRoot, '.pairofcleats.json');
const configExisted = fs.existsSync(configPath);
const originalConfig = configExisted ? await fsPromises.readFile(configPath, 'utf8') : null;
const userConfig = loadUserConfig(workRoot);
const indexExists = hasIndexArtifacts(workRoot, userConfig);
if (!indexExists || buildRequested) {
  const buildArgs = [path.join(toolRoot, 'build_index.js'), '--repo', workRoot];
  if (useStubEmbeddings) buildArgs.push('--stub-embeddings');
  runCommand('build index', buildArgs, envBase);
}

const strategies = [
  { id: 'sparse', annFlag: '--no-ann', blend: false },
  { id: 'ann-fallback', annFlag: '--ann', blend: false },
  { id: 'blend', annFlag: '--ann', blend: true }
];

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function runSearch(query, annFlag) {
  const args = [
    path.join(toolRoot, 'search.js'),
    query,
    '--repo',
    workRoot,
    '--json',
    '--json-compact',
    '--stats',
    '--backend',
    backend,
    '--top',
    String(topN),
    annFlag
  ];
  const output = runCommand('search', args, envBase);
  return JSON.parse(output || '{}');
}

const summaries = {};
for (const strategy of strategies) {
  await writeBlendConfig(workRoot, userConfig, strategy.blend);
  const latencies = [];
  const resultCounts = [];
  const topScores = [];
  const scoreTypeCounts = {};
  let hits = 0;
  for (const query of selectedQueries) {
    const payload = runSearch(query, strategy.annFlag);
    const stats = payload.stats || {};
    if (Number.isFinite(stats.elapsedMs)) latencies.push(stats.elapsedMs);
    const results = [
      ...(Array.isArray(payload.code) ? payload.code : []),
      ...(Array.isArray(payload.prose) ? payload.prose : [])
    ];
    resultCounts.push(results.length);
    if (results.length) hits += 1;
    if (results.length && Number.isFinite(results[0].score)) {
      topScores.push(results[0].score);
    }
    for (const item of results) {
      const type = item.scoreType || 'none';
      scoreTypeCounts[type] = (scoreTypeCounts[type] || 0) + 1;
    }
  }
  summaries[strategy.id] = {
    queries: selectedQueries.length,
    hitRate: selectedQueries.length ? hits / selectedQueries.length : 0,
    resultCountAvg: mean(resultCounts),
    latencyMsAvg: mean(latencies),
    topScoreAvg: mean(topScores),
    scoreTypes: scoreTypeCounts
  };
}

await restoreConfig(workRoot, originalConfig, configExisted);

const output = {
  generatedAt: new Date().toISOString(),
  repo: { source: repoSource, root: workRoot },
  backend,
  topN,
  queries: selectedQueries.length,
  strategies: summaries
};

if (argv.out) {
  const outPath = path.resolve(argv.out);
  await fsPromises.writeFile(outPath, JSON.stringify(output, null, 2));
}

if (argv.json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log('Score strategy benchmark');
  console.log(`- Repo: ${workRoot}`);
  console.log(`- Queries: ${selectedQueries.length}`);
  for (const [name, stats] of Object.entries(summaries)) {
    console.log(`- ${name} hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
    console.log(`- ${name} avg results: ${stats.resultCountAvg.toFixed(1)}`);
    console.log(`- ${name} avg latency: ${stats.latencyMsAvg.toFixed(1)} ms`);
  }
}
