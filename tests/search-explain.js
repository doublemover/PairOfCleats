#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'search-explain');
const cacheRoot = path.join(tempRoot, 'cache');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', fixtureRoot],
  { env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('search explain test failed: build_index failed');
  process.exit(buildResult.status ?? 1);
}

const stripAnsi = (value) => value.replace(/\u001b\[[0-9;]*m/g, '');

const runSearch = (args, label) => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'search.js'), 'return', '--mode', 'code', '--no-ann', '--repo', fixtureRoot, ...args],
    { env, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return stripAnsi(`${result.stdout || ''}${result.stderr || ''}`);
};

const runSearchJson = (args, label) => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'search.js'), 'return', '--mode', 'code', '--no-ann', '--repo', fixtureRoot, '--json', ...args],
    { env, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout || '{}');
};

const explainOutput = runSearch(['--explain'], 'explain');
if (!explainOutput.includes('Score:')) {
  console.error('Explain output missing Score breakdown.');
  process.exit(1);
}
if (!explainOutput.includes('Sparse:')) {
  console.error('Explain output missing Sparse breakdown.');
  process.exit(1);
}

const whyOutput = runSearch(['--why'], 'why');
if (!whyOutput.includes('Score:')) {
  console.error('Why output missing Score breakdown.');
  process.exit(1);
}

const jsonOutput = runSearchJson([], 'json');
const jsonHits = Array.isArray(jsonOutput.code) ? jsonOutput.code : [];
const hasExplain = jsonHits.some((hit) => hit && Object.prototype.hasOwnProperty.call(hit, 'scoreBreakdown'));
if (hasExplain) {
  console.error('Expected JSON output to omit scoreBreakdown when not requested.');
  process.exit(1);
}

console.log('search explain tests passed');
