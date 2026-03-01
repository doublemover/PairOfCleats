#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'bench-language-repos');
const reposRoot = path.join(tempRoot, 'repos');
const cacheRoot = path.join(tempRoot, 'cache');
const resultsRoot = path.join(tempRoot, 'results');
const configPath = path.join(tempRoot, 'repos.json');
const queriesPath = path.join(root, 'tests', 'fixtures', 'sample', 'queries.txt');
const repoId = 'test/repos-smoke';
const repoPath = path.join(reposRoot, 'javascript', repoId.replace('/', '__'));

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoPath, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
await fsPromises.mkdir(resultsRoot, { recursive: true });
await fsPromises.writeFile(path.join(repoPath, 'README.md'), 'bench repos smoke');

const config = {
  javascript: {
    label: 'JavaScript',
    queries: queriesPath,
    repos: {
      small: [repoId]
    }
  }
};
await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2));

const scriptPath = path.join(root, 'tools', 'bench', 'language-repos.js');
const result = spawnSync(
  process.execPath,
  [
    scriptPath,
    '--config',
    configPath,
    '--root',
    reposRoot,
    '--cache-root',
    cacheRoot,
    '--results',
    resultsRoot,
    '--no-clone',
    '--dry-run',
    '--json'
  ],
  { encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error(result.stderr || 'bench-language-repos test failed');
  process.exit(result.status ?? 1);
}

const payload = JSON.parse(result.stdout || '{}');
assert.ok(Array.isArray(payload.tasks), 'expected tasks array in bench payload');
assert.equal(payload.tasks.length, 1, 'expected exactly one scheduled bench task');
assert.equal(payload.tasks[0]?.repo, repoId, 'expected synthetic repo task in bench payload');

console.log('bench-language repos test passed');
