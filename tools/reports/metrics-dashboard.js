#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { readJsonFileSyncSafe, readJsonLinesSyncSafe } from '../../src/shared/files.js';
import { getMetricsDir, resolveRepoConfig } from '../shared/dict-utils.js';

const argv = createCli({
  scriptName: 'metrics-dashboard',
  options: {
    json: { type: 'boolean', default: false },
    out: { type: 'string' },
    repo: { type: 'string' },
    top: { type: 'number', default: 5 }
  }
}).parse();

const { repoRoot: root, userConfig } = resolveRepoConfig(argv.repo);
const metricsDir = getMetricsDir(root, userConfig);
const topN = Math.max(1, parseInt(argv.top, 10) || 5);

const indexMetrics = {
  code: readJsonFileSyncSafe(path.join(metricsDir, 'index-code.json')),
  prose: readJsonFileSyncSafe(path.join(metricsDir, 'index-prose.json'))
};

const fileMetrics = readJsonFileSyncSafe(path.join(metricsDir, 'metrics.json'), { fallback: {} }) || {};
const history = readJsonLinesSyncSafe(path.join(metricsDir, 'searchHistory'));
const noResults = readJsonLinesSyncSafe(path.join(metricsDir, 'noResultQueries'));

const fileRows = Object.entries(fileMetrics).map(([file, entry]) => {
  const md = entry?.md || 0;
  const code = entry?.code || 0;
  return { file, md, code, total: md + code, terms: entry?.terms || [] };
});
fileRows.sort((a, b) => b.total - a.total || a.file.localeCompare(b.file));

const termCounts = new Map();
for (const row of fileRows) {
  for (const term of row.terms || []) {
    termCounts.set(term, (termCounts.get(term) || 0) + 1);
  }
}
const termRows = Array.from(termCounts.entries())
  .map(([term, count]) => ({ term, count }))
  .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));

const queryCounts = new Map();
let totalMs = 0;
for (const entry of history) {
  if (entry?.query) queryCounts.set(entry.query, (queryCounts.get(entry.query) || 0) + 1);
  if (Number.isFinite(entry?.ms)) totalMs += entry.ms;
}
const queryRows = Array.from(queryCounts.entries())
  .map(([query, count]) => ({ query, count }))
  .sort((a, b) => b.count - a.count || a.query.localeCompare(b.query));

const avgMs = history.length ? totalMs / history.length : 0;
const lastQuery = history.length ? history[history.length - 1] : null;

const dashboard = {
  generatedAt: new Date().toISOString(),
  metricsDir: path.resolve(metricsDir),
  index: indexMetrics,
  search: {
    totalQueries: history.length,
    avgMs,
    lastQueryAt: lastQuery?.time || null,
    noResultCount: noResults.length,
    topQueries: queryRows.slice(0, topN)
  },
  files: {
    topHits: fileRows.slice(0, topN)
  },
  terms: {
    top: termRows.slice(0, topN)
  }
};

console.error(`Metrics dashboard (${path.resolve(metricsDir)})`);
console.error(`- Queries: ${dashboard.search.totalQueries} (avg ${avgMs.toFixed(1)} ms)`);
console.error(`- No-result queries: ${dashboard.search.noResultCount}`);
if (indexMetrics.code) {
  console.error(`- Code index: ${indexMetrics.code.chunks?.total || 0} chunks, ${indexMetrics.code.tokens?.total || 0} tokens`);
}
if (indexMetrics.prose) {
  console.error(`- Prose index: ${indexMetrics.prose.chunks?.total || 0} chunks, ${indexMetrics.prose.tokens?.total || 0} tokens`);
}
if (queryRows.length) {
  console.error(`- Top queries: ${queryRows.slice(0, topN).map((q) => `${q.query} (${q.count})`).join(', ')}`);
}
if (fileRows.length) {
  console.error(`- Top files: ${fileRows.slice(0, topN).map((row) => `${row.file} (${row.total})`).join(', ')}`);
}
if (termRows.length) {
  console.error(`- Top terms: ${termRows.slice(0, topN).map((row) => `${row.term} (${row.count})`).join(', ')}`);
}

if (argv.json) {
  console.log(`\n${JSON.stringify(dashboard, null, 2)}`);
}

if (argv.out) {
  const outPath = path.resolve(argv.out);
  await fsPromises.mkdir(path.dirname(outPath), { recursive: true });
  await fsPromises.writeFile(outPath, JSON.stringify(dashboard, null, 2));
  console.error(`\nJSON written to ${outPath}`);
}
