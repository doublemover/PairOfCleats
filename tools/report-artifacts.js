#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { getStatus } from '../src/integrations/core/status.js';

const argv = createCli({
  scriptName: 'report-artifacts',
  options: {
    json: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    repo: { type: 'string' }
  }
}).parse();

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const status = await getStatus({ repoRoot: rootArg, includeAll: argv.all });

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

const repo = status.repo;
const overall = status.overall;
const code = repo.sqlite?.code;
const prose = repo.sqlite?.prose;

console.log('Repo artifacts');
console.log(`- cache root: ${formatBytes(repo.totalBytes)} (${repo.root})`);
console.log(`- index-code: ${formatBytes(repo.artifacts.indexCode)} (${path.join(repo.root, 'index-code')})`);
console.log(`- index-prose: ${formatBytes(repo.artifacts.indexProse)} (${path.join(repo.root, 'index-prose')})`);
console.log(`- repometrics: ${formatBytes(repo.artifacts.repometrics)} (${path.join(repo.root, 'repometrics')})`);
console.log(`- incremental: ${formatBytes(repo.artifacts.incremental)} (${path.join(repo.root, 'incremental')})`);
console.log(`- sqlite code db: ${code ? formatBytes(code.bytes) : 'missing'} (${code?.path || status.repo.sqlite?.code?.path || 'missing'})`);
console.log(`- sqlite prose db: ${prose ? formatBytes(prose.bytes) : 'missing'} (${prose?.path || status.repo.sqlite?.prose?.path || 'missing'})`);
if (repo.sqlite?.legacy) {
  console.log(`- legacy sqlite db: ${repo.sqlite.legacy.path}`);
}

console.log('\nOverall');
console.log(`- cache root: ${formatBytes(overall.cacheBytes)} (${overall.cacheRoot})`);
console.log(`- dictionaries: ${formatBytes(overall.dictionaryBytes)}`);
if (overall.sqliteOutsideCacheBytes) {
  console.log(`- sqlite outside cache: ${formatBytes(overall.sqliteOutsideCacheBytes)}`);
}
console.log(`- total: ${formatBytes(overall.totalBytes)}`);

if (status.health?.issues?.length) {
  console.log('\nHealth');
  status.health.issues.forEach((issue) => console.log(`- issue: ${issue}`));
  status.health.hints.forEach((hint) => console.log(`- hint: ${hint}`));
}

if (status.allRepos) {
  const repos = status.allRepos.repos.slice().sort((a, b) => b.bytes - a.bytes);
  console.log('\nAll repos');
  console.log(`- root: ${status.allRepos.root}`);
  console.log(`- total: ${formatBytes(status.allRepos.totalBytes)}`);
  for (const repoEntry of repos) {
    console.log(`- ${repoEntry.id}: ${formatBytes(repoEntry.bytes)} (${repoEntry.path})`);
  }
}
