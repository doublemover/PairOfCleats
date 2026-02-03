#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { createToolDisplay } from '../shared/cli-display.js';
import { search as coreSearch } from '../../src/integrations/core/index.js';
import { createSqliteDbCache } from '../../src/retrieval/sqlite-cache.js';
import { matchExpected, resolveMatchMode } from './match.js';

const argv = createCli({
  scriptName: 'eval-run',
  options: {
    repo: { type: 'string' },
    dataset: { type: 'string' },
    backend: { type: 'string', default: 'auto' },
    top: { type: 'number', default: 10 },
    ann: { type: 'boolean' },
    out: { type: 'string' },
    pretty: { type: 'boolean', default: false },
    'match-mode': { type: 'string' },
    progress: { type: 'string', default: 'auto' },
    verbose: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false }
  },
  aliases: { n: 'top' }
}).parse();

const display = createToolDisplay({
  argv,
  stream: process.stderr,
  displayOptions: { json: true }
});
const fail = (message, code = 1) => {
  display.error(message);
  display.close();
  process.exit(code);
};

const root = process.cwd();
const repoRoot = argv.repo ? path.resolve(argv.repo) : root;
const datasetPath = argv.dataset
  ? path.resolve(argv.dataset)
  : path.join(root, 'tests', 'fixtures', 'sample', 'eval.json');
const backend = argv.backend ? String(argv.backend) : 'auto';
const topN = Math.max(1, parseInt(argv.top, 10) || 10);
const annFlag = typeof argv.ann === 'boolean' ? argv.ann : null;
const ks = [1, 3, 5, 10].filter((k) => k <= Math.max(10, topN));
const matchMode = (() => {
  try {
    return resolveMatchMode(argv['match-mode']);
  } catch (err) {
    fail(err?.message || 'Invalid match mode.', 2);
  }
})();

const loadDataset = () => {
  const raw = fs.readFileSync(datasetPath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) return [];
  return data;
};

const isMatch = (hit, expected) => matchExpected(hit, expected, matchMode);

const computeRecallAtK = (ranks, totalRelevant, k) => {
  if (!totalRelevant) return 0;
  const found = ranks.filter((rank) => rank <= k).length;
  return found / totalRelevant;
};

const computeMRR = (ranks) => {
  if (!ranks.length) return 0;
  return 1 / Math.min(...ranks);
};

const computeNDCG = (ranks, totalRelevant, k) => {
  if (!totalRelevant) return 0;
  const hits = ranks.filter((rank) => rank <= k).sort((a, b) => a - b);
  if (!hits.length) return 0;
  const dcg = hits.reduce((sum, rank) => sum + 1 / Math.log2(rank + 1), 0);
  const idealCount = Math.min(totalRelevant, k);
  let idcg = 0;
  for (let i = 1; i <= idealCount; i += 1) {
    idcg += 1 / Math.log2(i + 1);
  }
  return idcg ? dcg / idcg : 0;
};

const runSearch = async (query, mode) => {
  const args = ['--json', '--repo', repoRoot, '-n', String(topN)];
  if (mode && mode !== 'both') args.push('--mode', mode);
  if (backend && backend !== 'auto') args.push('--backend', backend);
  if (annFlag === true) args.push('--ann');
  if (annFlag === false) args.push('--no-ann');

  const payload = await coreSearch(repoRoot, {
    args,
    query,
    emitOutput: false,
    exitOnError: false,
    indexCache: evalCaches.indexCache,
    sqliteCache: evalCaches.sqliteCache
  });
  if (mode === 'code') return payload.code || [];
  if (mode === 'prose') return payload.prose || [];
  return [...(payload.code || []), ...(payload.prose || [])];
};

const evalCaches = {
  indexCache: new Map(),
  sqliteCache: createSqliteDbCache()
};

const cases = loadDataset();
if (!cases.length) {
  fail(`No eval cases found at ${datasetPath}`);
}

const results = [];
const queryTask = display.task('Queries', { total: cases.length, stage: 'queries' });
let processedCases = 0;
for (const entry of cases) {
  const query = String(entry?.query || '').trim();
  if (!query) continue;
  const mode = entry.mode || 'both';
  const silver = Array.isArray(entry.relevant)
    ? entry.relevant
    : (Array.isArray(entry.expect) ? entry.expect : []);
  const gold = Array.isArray(entry.gold) ? entry.gold : [];

  const hits = await runSearch(query, mode);
  const ranks = [];
  const goldRanks = [];
  hits.forEach((hit, index) => {
    const rank = index + 1;
    if (silver.some((exp) => isMatch(hit, exp))) ranks.push(rank);
    if (gold.some((exp) => isMatch(hit, exp))) goldRanks.push(rank);
  });

  const metrics = {
    recallAtK: Object.fromEntries(ks.map((k) => [k, computeRecallAtK(ranks, silver.length, k)])),
    mrr: computeMRR(ranks),
    ndcgAtK: Object.fromEntries(ks.map((k) => [k, computeNDCG(ranks, silver.length, k)]))
  };
  const goldMetrics = gold.length
    ? {
      recallAtK: Object.fromEntries(ks.map((k) => [k, computeRecallAtK(goldRanks, gold.length, k)])),
      mrr: computeMRR(goldRanks),
      ndcgAtK: Object.fromEntries(ks.map((k) => [k, computeNDCG(goldRanks, gold.length, k)]))
    }
    : null;

  results.push({
    query,
    mode,
    totals: {
      relevant: silver.length,
      gold: gold.length,
      hits: hits.length
    },
    metrics,
    goldMetrics
  });
  processedCases += 1;
  queryTask.set(processedCases, cases.length);
}

const aggregate = (field) => {
  if (!results.length) return 0;
  const sum = results.reduce((acc, entry) => acc + (entry.metrics?.[field] || 0), 0);
  return sum / results.length;
};

const aggregateMap = (key) => {
  const totals = {};
  if (!results.length) return totals;
  for (const k of ks) {
    const sum = results.reduce((acc, entry) => acc + (entry.metrics?.[key]?.[k] || 0), 0);
    totals[k] = sum / results.length;
  }
  return totals;
};

const summary = {
  cases: results.length,
  recallAtK: aggregateMap('recallAtK'),
  ndcgAtK: aggregateMap('ndcgAtK'),
  mrr: aggregate('mrr')
};

const output = {
  generatedAt: new Date().toISOString(),
  repo: repoRoot,
  dataset: datasetPath,
  backend,
  topN,
  ann: annFlag,
  ks,
  summary,
  results
};

if (argv.out) {
  fs.writeFileSync(path.resolve(argv.out), JSON.stringify(output, null, 2));
}

const payload = argv.pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output);
display.close();
console.log(payload);
