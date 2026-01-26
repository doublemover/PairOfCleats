#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { getStatus } from '../src/integrations/core/status.js';
import { validateIndexArtifacts } from '../src/index/validate.js';
import { getMetricsDir, loadUserConfig, resolveRepoRoot } from './dict-utils.js';

const argv = createCli({
  scriptName: 'report-artifacts',
  options: {
    json: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    repo: { type: 'string' }
  }
}).parse();

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const root = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(root);
const metricsDir = getMetricsDir(root, userConfig);
const status = await getStatus({ repoRoot: root, includeAll: argv.all });

const readJson = (targetPath) => {
  if (!fs.existsSync(targetPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch {
    return null;
  }
};

const indexMetrics = {
  code: readJson(path.join(metricsDir, 'index-code.json')),
  prose: readJson(path.join(metricsDir, 'index-prose.json')),
  extractedProse: readJson(path.join(metricsDir, 'index-extracted-prose.json')),
  records: readJson(path.join(metricsDir, 'index-records.json'))
};
const lmdbMetrics = {
  code: readJson(path.join(metricsDir, 'lmdb-code.json')),
  prose: readJson(path.join(metricsDir, 'lmdb-prose.json'))
};

const computeRate = (count, ms) => {
  const total = Number(count);
  const elapsed = Number(ms);
  if (!Number.isFinite(total) || !Number.isFinite(elapsed) || elapsed <= 0) return null;
  return total / (elapsed / 1000);
};

const buildThroughput = (mode, metrics, bytes) => {
  if (!metrics) return null;
  const totalMs = Number(metrics?.timings?.totalMs);
  const writeMs = Number(metrics?.timings?.writeMs);
  const files = Number(metrics?.files?.candidates);
  const chunks = Number(metrics?.chunks?.total);
  const tokens = Number(metrics?.tokens?.total);
  const payload = {
    mode,
    totalMs: Number.isFinite(totalMs) ? totalMs : null,
    writeMs: Number.isFinite(writeMs) ? writeMs : null,
    files: Number.isFinite(files) ? files : null,
    chunks: Number.isFinite(chunks) ? chunks : null,
    tokens: Number.isFinite(tokens) ? tokens : null,
    bytes: Number.isFinite(Number(bytes)) ? Number(bytes) : null
  };
  payload.filesPerSec = computeRate(payload.files, payload.totalMs);
  payload.chunksPerSec = computeRate(payload.chunks, payload.totalMs);
  payload.tokensPerSec = computeRate(payload.tokens, payload.totalMs);
  payload.bytesPerSec = computeRate(payload.bytes, payload.totalMs);
  payload.writeBytesPerSec = computeRate(payload.bytes, payload.writeMs);
  return payload;
};

const throughput = {
  code: buildThroughput('code', indexMetrics.code, status.repo?.artifacts?.indexCode),
  prose: buildThroughput('prose', indexMetrics.prose, status.repo?.artifacts?.indexProse),
  extractedProse: buildThroughput('extracted-prose', indexMetrics.extractedProse, status.repo?.artifacts?.indexExtractedProse),
  records: buildThroughput('records', indexMetrics.records, status.repo?.artifacts?.indexRecords),
  lmdb: {
    code: buildThroughput('lmdb code', lmdbMetrics.code, status.repo?.lmdb?.code?.bytes),
    prose: buildThroughput('lmdb prose', lmdbMetrics.prose, status.repo?.lmdb?.prose?.bytes)
  }
};

const corruption = await validateIndexArtifacts({
  root,
  userConfig,
  modes: ['code', 'prose', 'extracted-prose', 'records']
});
status.throughput = throughput;
status.corruption = corruption;

if (argv.json) {
  console.log(JSON.stringify(status, null, 2));
  process.exit(0);
}

/**
 * Format a byte count as a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${rounded} ${units[unit]}`;
}

const formatBytesWithRaw = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return 'missing';
  return `${formatBytes(bytes)} (${bytes.toLocaleString()} bytes)`;
};

const repo = status.repo;
const overall = status.overall;
const code = repo.sqlite?.code;
const prose = repo.sqlite?.prose;
const extractedProse = repo.sqlite?.extractedProse;
const records = repo.sqlite?.records;
const lmdbCode = repo.lmdb?.code;
const lmdbProse = repo.lmdb?.prose;

console.error('Repo artifacts');
console.error(`- cache root: ${formatBytes(repo.totalBytes)} (${repo.root})`);
console.error(`- index-code: ${formatBytesWithRaw(repo.artifacts.indexCode)}`);
console.error(`- index-prose: ${formatBytesWithRaw(repo.artifacts.indexProse)}`);
console.error(`- index-extracted-prose: ${formatBytesWithRaw(repo.artifacts.indexExtractedProse)}`);
console.error(`- index-records: ${formatBytesWithRaw(repo.artifacts.indexRecords)}`);
console.error(`- repometrics: ${formatBytes(repo.artifacts.repometrics)} (${path.join(repo.root, 'repometrics')})`);
console.error(`- incremental: ${formatBytes(repo.artifacts.incremental)} (${path.join(repo.root, 'incremental')})`);
console.error(`- sqlite code db: ${code ? formatBytesWithRaw(code.bytes) : 'missing'} (${code?.path || status.repo.sqlite?.code?.path || 'missing'})`);
console.error(`- sqlite prose db: ${prose ? formatBytesWithRaw(prose.bytes) : 'missing'} (${prose?.path || status.repo.sqlite?.prose?.path || 'missing'})`);
console.error(`- sqlite extracted-prose db: ${extractedProse ? formatBytesWithRaw(extractedProse.bytes) : 'missing'} (${extractedProse?.path || status.repo.sqlite?.extractedProse?.path || 'missing'})`);
console.error(`- sqlite records db: ${records ? formatBytesWithRaw(records.bytes) : 'missing'} (${records?.path || status.repo.sqlite?.records?.path || 'missing'})`);
console.error(`- lmdb code db: ${lmdbCode ? formatBytesWithRaw(lmdbCode.bytes) : 'missing'} (${lmdbCode?.path || status.repo.lmdb?.code?.path || 'missing'})`);
console.error(`- lmdb prose db: ${lmdbProse ? formatBytesWithRaw(lmdbProse.bytes) : 'missing'} (${lmdbProse?.path || status.repo.lmdb?.prose?.path || 'missing'})`);
if (repo.sqlite?.legacy) {
  console.error(`- legacy sqlite db: ${repo.sqlite.legacy.path}`);
}

console.error('\nOverall');
console.error(`- cache root: ${formatBytes(overall.cacheBytes)} (${overall.cacheRoot})`);
console.error(`- dictionaries: ${formatBytes(overall.dictionaryBytes)}`);
if (overall.sqliteOutsideCacheBytes) {
  console.error(`- sqlite outside cache: ${formatBytes(overall.sqliteOutsideCacheBytes)}`);
}
if (overall.lmdbOutsideCacheBytes) {
  console.error(`- lmdb outside cache: ${formatBytes(overall.lmdbOutsideCacheBytes)}`);
}
console.error(`- total: ${formatBytes(overall.totalBytes)}`);

if (status.health?.issues?.length) {
  console.error('\nHealth');
  status.health.issues.forEach((issue) => console.error(`- issue: ${issue}`));
  status.health.hints.forEach((hint) => console.error(`- hint: ${hint}`));
}

if (status.throughput) {
  const formatRate = (value, unit) => (Number.isFinite(value) ? `${value.toFixed(1)} ${unit}/s` : 'n/a');
  const formatMs = (value) => (Number.isFinite(value) ? `${value.toFixed(0)} ms` : 'n/a');
  console.error('\nThroughput');
  const entries = [
    ['code', status.throughput.code],
    ['prose', status.throughput.prose],
    ['extracted-prose', status.throughput.extractedProse],
    ['records', status.throughput.records],
    ['lmdb code', status.throughput.lmdb?.code],
    ['lmdb prose', status.throughput.lmdb?.prose]
  ];
  for (const [mode, entry] of entries) {
    if (!entry) continue;
    console.error(
      `- ${mode}: files ${formatRate(entry.filesPerSec, 'files')}, ` +
      `chunks ${formatRate(entry.chunksPerSec, 'chunks')}, ` +
      `tokens ${formatRate(entry.tokensPerSec, 'tokens')}, ` +
      `bytes ${formatRate(entry.bytesPerSec, 'bytes')} (total ${formatMs(entry.totalMs)})`
    );
  }
}

if (status.corruption) {
  const validation = status.corruption;
  const statusLabel = validation.ok ? 'ok' : 'issues';
  console.error('\nIntegrity');
  console.error(`- index-validate: ${statusLabel}`);
  if (!validation.ok && validation.issues?.length) {
    validation.issues.forEach((issue) => console.error(`- issue: ${issue}`));
  }
  if (validation.warnings?.length) {
    validation.warnings.forEach((warning) => console.error(`- warning: ${warning}`));
  }
}

if (status.allRepos) {
  const repos = status.allRepos.repos.slice().sort((a, b) => b.bytes - a.bytes);
  console.error('\nAll repos');
  console.error(`- root: ${status.allRepos.root}`);
  console.error(`- total: ${formatBytes(status.allRepos.totalBytes)}`);
  for (const repoEntry of repos) {
    console.error(`- ${repoEntry.id}: ${formatBytes(repoEntry.bytes)} (${repoEntry.path})`);
  }
}
