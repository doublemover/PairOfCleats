#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getMetricsDir, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'repometrics-dashboard');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
const userConfig = loadUserConfig(repoRoot);
const metricsDir = getMetricsDir(repoRoot, userConfig);
await fsPromises.mkdir(metricsDir, { recursive: true });

await fsPromises.writeFile(
  path.join(metricsDir, 'index-code.json'),
  JSON.stringify({ chunks: { total: 10 }, tokens: { total: 120 } }, null, 2)
);
await fsPromises.writeFile(
  path.join(metricsDir, 'index-prose.json'),
  JSON.stringify({ chunks: { total: 5 }, tokens: { total: 80 } }, null, 2)
);
await fsPromises.writeFile(
  path.join(metricsDir, 'metrics.json'),
  JSON.stringify({
    'src/a.js': { md: 0, code: 3, terms: ['foo', 'bar'] },
    'docs/readme.md': { md: 2, code: 0, terms: ['readme'] }
  }) + '\n'
);
await fsPromises.writeFile(
  path.join(metricsDir, 'searchHistory'),
  [
    JSON.stringify({ time: new Date().toISOString(), query: 'foo', ms: 12, mdFiles: 0, codeFiles: 1 }),
    JSON.stringify({ time: new Date().toISOString(), query: 'bar', ms: 25, mdFiles: 1, codeFiles: 0 })
  ].join('\n') + '\n'
);
await fsPromises.writeFile(
  path.join(metricsDir, 'noResultQueries'),
  JSON.stringify({ time: new Date().toISOString(), query: 'missing' }) + '\n'
);

const outPath = path.join(tempRoot, 'dashboard.json');
const env = { ...process.env, PAIROFCLEATS_CACHE_ROOT: cacheRoot };
const result = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'repometrics-dashboard.js'), '--json', '--out', outPath],
  { cwd: repoRoot, env, encoding: 'utf8' }
);
if (result.status !== 0) {
  console.error('repometrics dashboard test failed: script error.');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}
if (!fs.existsSync(outPath)) {
  console.error('repometrics dashboard test failed: output JSON missing.');
  process.exit(1);
}
const payload = JSON.parse(fs.readFileSync(outPath, 'utf8'));
if (!payload.search || !payload.files || !payload.index) {
  console.error('repometrics dashboard test failed: missing fields.');
  process.exit(1);
}

console.log('repometrics dashboard test passed');

